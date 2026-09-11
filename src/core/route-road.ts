import { AppError } from "./errors";
import type { OrderBoard, Shipment } from "./orders-contract";
import type {
  PublicOptimizedRoute,
  RouteMetrics,
  RoutingSettings,
} from "./routing-contract";
import { localMinuteInstant } from "./route-optimization-google";

export type Coordinate = { latitude: number; longitude: number };
export type RoadLeg = {
  distance: number;
  seconds: number;
  polyline: string;
  token: string | null;
  trafficMode: "forecast" | "static";
};
export type CalculatedRoute = PublicOptimizedRoute & {
  transitions: { encodedPolyline: string | null; routeToken: string | null }[];
};
export const emptyMetrics = (): RouteMetrics => ({
  travelDistanceMeters: 0,
  travelDurationSeconds: 0,
  waitDurationSeconds: 0,
  totalDurationSeconds: 0,
  performedShipmentCount: 0,
});

export function roadRequest(
  from: Coordinate,
  to: Coordinate,
  departure: string,
  now: number,
) {
  for (const point of [from, to]) {
    if (
      !Number.isFinite(point.latitude) ||
      Math.abs(point.latitude) > 90 ||
      !Number.isFinite(point.longitude) ||
      Math.abs(point.longitude) > 180
    )
      throw new AppError("ROUTING_POINTS_REQUIRED", 409);
  }
  const instant = Date.parse(departure);
  if (!Number.isFinite(instant) || !Number.isFinite(now))
    throw new AppError("ROUTING_MODEL_INVALID");
  const future = instant > now;
  return {
    origin: { location: { latLng: from } },
    destination: { location: { latLng: to } },
    travelMode: "DRIVE",
    routingPreference: future ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE",
    ...(future ? { departureTime: departure } : {}),
    computeAlternativeRoutes: false,
    polylineQuality: "HIGH_QUALITY",
    languageCode: "es-MX",
    units: "METRIC",
  };
}

export function parseRoadLeg(value: unknown, forecast: boolean): RoadLeg {
  if (!value || typeof value !== "object")
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  const routes = (value as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || routes.length !== 1)
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  const route = routes[0];
  const seconds =
    typeof route?.duration === "string" && route.duration.endsWith("s")
      ? Number(route.duration.slice(0, -1))
      : NaN;
  if (
    !Number.isSafeInteger(route?.distanceMeters) ||
    route.distanceMeters < 0 ||
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    typeof route?.polyline?.encodedPolyline !== "string" ||
    !route.polyline.encodedPolyline.length
  )
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  return {
    distance: route.distanceMeters,
    seconds: Math.ceil(seconds),
    polyline: route.polyline.encodedPolyline,
    token: typeof route.routeToken === "string" ? route.routeToken : null,
    trafficMode: forecast ? "forecast" : "static",
  };
}

export async function requestRoadLeg(
  from: Coordinate,
  to: Coordinate,
  departure: string,
): Promise<RoadLeg> {
  const key = process.env.RUTAS_GOOGLE_ROUTES_API_KEY?.trim();
  if (!key) throw new AppError("ROUTING_ROADS_CONFIG_MISSING", 503);
  const request = roadRequest(from, to, departure, Date.now());
  let response: Response;
  try {
    response = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.routeToken",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(30000),
      },
    );
  } catch {
    throw new AppError("ROUTING_GOOGLE_UNAVAILABLE", 503);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError(
      response.status === 429
        ? "ROUTING_GOOGLE_QUOTA"
        : response.status === 401 || response.status === 403
          ? "ROUTING_GOOGLE_DENIED"
          : "ROUTING_GOOGLE_UNAVAILABLE",
      503,
    );
  }
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 20 * 1024 * 1024) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(part.value);
    }
    return parseRoadLeg(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
      "departureTime" in request,
    );
  } catch {
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  }
}

export function visitTiming(
  arrival: number,
  windows: { start: number; end: number }[],
) {
  if (!Number.isFinite(arrival)) throw new AppError("ROUTING_MODEL_INVALID");
  const ordered = [...windows].sort((a, b) => a.start - b.start);
  if (
    ordered.some(
      (w) =>
        !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end < w.start,
    )
  )
    throw new AppError("ROUTING_MODEL_INVALID");
  const window = ordered.find((w) => arrival <= w.end);
  const eta = window ? Math.max(arrival, window.start) : arrival;
  const lastEnd = ordered.length
    ? Math.max(...ordered.map((w) => w.end))
    : arrival;
  return {
    eta,
    waitDurationSeconds: Math.ceil((eta - arrival) / 1000),
    lateSeconds: Math.max(0, Math.ceil((arrival - lastEnd) / 1000)),
  };
}

export async function calculateManualRoutes(
  board: OrderBoard,
  settings: RoutingSettings,
  timezone: string,
  onProgress: () => Promise<void> = async () => {},
) {
  if (!settings.depotLocation)
    throw new AppError("ROUTING_ORIGIN_REQUIRED", 409);
  if (board.plan.departure_minute == null)
    throw new AppError("ROUTING_DEPARTURE_REQUIRED", 409);
  const departureAt = localMinuteInstant(
    board.plan.service_date,
    board.plan.departure_minute,
    timezone,
  );
  const depot: Coordinate = {
    latitude: settings.depotLocation.latitude,
    longitude: settings.depotLocation.longitude,
  };
  const routes: CalculatedRoute[] = [];
  const visited = new Map<
    string,
    { shipment: Shipment; stop: PublicOptimizedRoute["stops"][number] }
  >();
  for (const vehicle of board.vehicles) {
    const shipments = board.shipments.filter(
      (s) =>
        s.vehicle_id === vehicle.id &&
        s.fulfillmentMode === "delivery" &&
        !s.customerArchived,
    );
    const metrics = emptyMetrics();
    const route: CalculatedRoute = {
      vehicleId: vehicle.id,
      vehicleName: vehicle.name,
      encodedPolyline: null,
      segmentPolylines: [],
      departureAt,
      finishedAt: departureAt,
      trafficMode: Date.parse(departureAt) > Date.now() ? "forecast" : "static",
      metrics,
      stops: [],
      transitions: [],
    };
    let point = depot,
      instant = Date.parse(departureAt);
    const drive = async (to: Coordinate) => {
      await onProgress();
      if (point.latitude === to.latitude && point.longitude === to.longitude)
        return;
      const leg = await requestRoadLeg(
        point,
        to,
        new Date(instant).toISOString(),
      );
      instant += leg.seconds * 1000;
      metrics.travelDistanceMeters += leg.distance;
      metrics.travelDurationSeconds += leg.seconds;
      route.segmentPolylines!.push(leg.polyline);
      route.transitions.push({
        encodedPolyline: leg.polyline,
        routeToken: leg.token,
      });
      if (leg.trafficMode === "static") route.trafficMode = "static";
      point = to;
    };
    for (const shipment of shipments) {
      if (
        shipment.latitude === null ||
        shipment.longitude === null ||
        shipment.locationStatus === "pending"
      )
        throw new AppError("ROUTING_POINTS_REQUIRED", 409);
      const beforeDistance = metrics.travelDistanceMeters,
        beforeTime = metrics.travelDurationSeconds;
      await drive({
        latitude: shipment.latitude,
        longitude: shipment.longitude,
      });
      const timing = visitTiming(
        instant,
        shipment.deliveryWindows.map((w) => ({
          start: Date.parse(
            localMinuteInstant(
              board.plan.service_date,
              w.startMinute,
              timezone,
            ),
          ),
          end: Date.parse(
            localMinuteInstant(board.plan.service_date, w.endMinute, timezone),
          ),
        })),
      );
      instant = timing.eta;
      metrics.waitDurationSeconds += timing.waitDurationSeconds;
      const stop = {
        shipmentId: shipment.id,
        position: route.stops.length + 1,
        eta: new Date(instant).toISOString(),
        travelDistanceMeters: metrics.travelDistanceMeters - beforeDistance,
        travelDurationSeconds: metrics.travelDurationSeconds - beforeTime,
        waitDurationSeconds: timing.waitDurationSeconds,
        lateSeconds: timing.lateSeconds,
        priorityConflict: false,
      };
      route.stops.push(stop);
      visited.set(shipment.id, { shipment, stop });
    }
    if (shipments.length) await drive(depot);
    route.finishedAt = new Date(instant).toISOString();
    metrics.totalDurationSeconds = Math.ceil(
      (instant - Date.parse(departureAt)) / 1000,
    );
    metrics.performedShipmentCount = shipments.length;
    routes.push(route);
  }
  const rank = { high: 0, medium: 1, schedule: 2 };
  for (const current of visited.values())
    current.stop.priorityConflict = [...visited.values()].some(
      (other) =>
        rank[other.shipment.priority] < rank[current.shipment.priority] &&
        Date.parse(other.stop.eta) > Date.parse(current.stop.eta),
    );
  const metrics = emptyMetrics();
  for (const route of routes)
    for (const key of Object.keys(metrics) as (keyof RouteMetrics)[])
      metrics[key] += route.metrics[key];
  return { routes, metrics };
}
