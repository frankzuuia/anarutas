import { GoogleAuth } from "google-auth-library";
import { AppError } from "./errors";
import { dayAfter, localMidnight } from "./orders-validation";
import type { OrderBoard, Shipment } from "./orders-contract";
import type { GoogleServiceAccount } from "./routing-config";
import type { RouteMetrics } from "./routing-contract";
import type { RoutingSettings } from "./routing-contract";

type GoogleTimeWindow = { startTime: string; endTime: string };
type GoogleOptimizationRequest = {
  timeout: string;
  considerRoadTraffic: true;
  populatePolylines: true;
  populateTransitionPolylines: true;
  model: {
    globalStartTime: string;
    globalEndTime: string;
    shipments: {
      label: string;
      deliveries: {
        label: string;
        arrivalLocation: { latitude: number; longitude: number };
        timeWindows?: GoogleTimeWindow[];
      }[];
    }[];
    vehicles: {
      label: string;
      travelMode: "DRIVING";
      startLocation: { latitude: number; longitude: number };
      costPerHour: number;
    }[];
    precedenceRules?: {
      firstIsDelivery: true;
      secondIsDelivery: true;
      firstIndex: number;
      secondIndex: number;
    }[];
  };
};

export type GoogleRouteResult = {
  vehicleIndex: number;
  encodedPolyline: string | null;
  metrics: RouteMetrics;
  visits: {
    shipmentIndex: number;
    eta: string;
    travelDistanceMeters: number;
    travelDurationSeconds: number;
    waitDurationSeconds: number;
  }[];
  transitions: {
    encodedPolyline: string | null;
    routeToken: string | null;
  }[];
};

export type GoogleOptimizationResult = {
  routes: GoogleRouteResult[];
  skipped: { shipmentIndex: number; reasons: string[] }[];
  metrics: RouteMetrics;
};

const priorityRank: Record<Shipment["priority"], number> = {
  high: 0,
  medium: 1,
  schedule: 2,
};

export function optimizationTimeoutSeconds(shipments: number) {
  if (shipments <= 8) return 5;
  if (shipments <= 32) return 20;
  if (shipments <= 100) return 60;
  if (shipments <= 1000) return 180;
  return Math.min(
    1800,
    900 + Math.max(0, Math.ceil((shipments - 10000) / 10000)) * 120,
  );
}

export function localMinuteInstant(
  date: string,
  minute: number,
  timezone: string,
) {
  if (!Number.isSafeInteger(minute) || minute < 0 || minute >= 1440)
    throw new AppError("ROUTING_MODEL_INVALID");
  const midnight = Date.parse(
    `${localMidnight(date, timezone).replace(" ", "T")}Z`,
  );
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const target = Date.parse(
    `${date}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00Z`,
  );
  let instant = midnight;
  // Stryker disable next-line EqualityOperator,UpdateOperator: five is a defensive fixed-point ceiling; valid civil instants converge before the boundary.
  for (let attempt = 0; attempt < 5; attempt++) {
    const parts = Object.fromEntries(
      format.formatToParts(instant).map((part) => [part.type, part.value]),
    );
    const represented = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    const delta = target - represented;
    if (delta === 0) return new Date(instant).toISOString();
    instant += delta;
  }
  throw new AppError("DATE_BOUNDARY_UNSUPPORTED");
}

function precedenceRules(shipments: Shipment[]) {
  const rules: NonNullable<
    GoogleOptimizationRequest["model"]["precedenceRules"]
  > = [];
  for (let first = 0; first < shipments.length; first++)
    for (let second = 0; second < shipments.length; second++)
      if (
        priorityRank[shipments[first].priority] <
        priorityRank[shipments[second].priority]
      )
        rules.push({
          firstIsDelivery: true,
          secondIsDelivery: true,
          firstIndex: first,
          secondIndex: second,
        });
  return rules;
}

export function buildGoogleOptimizationRequest(
  board: OrderBoard,
  settings: RoutingSettings,
  timezone: string,
): GoogleOptimizationRequest {
  if (!settings.depotLocation)
    throw new AppError("ROUTING_ORIGIN_REQUIRED", 409);
  if (!board.vehicles.length)
    throw new AppError("ROUTING_VEHICLES_REQUIRED", 409);
  const invalid = board.shipments.filter(
    (shipment) =>
      shipment.fulfillmentMode === "delivery" &&
      !shipment.customerArchived &&
      (shipment.latitude === null ||
        shipment.longitude === null ||
        shipment.locationStatus === "pending"),
  );
  if (invalid.length)
    throw new AppError("ROUTING_POINTS_REQUIRED", 409, {
      count: invalid.length,
    });
  const deliveries = board.shipments.filter(
    (shipment) =>
      shipment.fulfillmentMode === "delivery" && !shipment.customerArchived,
  );
  if (!deliveries.length) throw new AppError("ROUTING_ORDERS_REQUIRED", 409);
  const start = `${localMidnight(board.plan.service_date, timezone).replace(" ", "T")}Z`;
  const end = `${localMidnight(dayAfter(board.plan.service_date), timezone).replace(" ", "T")}Z`;
  const rules = precedenceRules(deliveries);
  return {
    timeout: `${optimizationTimeoutSeconds(deliveries.length)}s`,
    considerRoadTraffic: true,
    populatePolylines: true,
    populateTransitionPolylines: true,
    model: {
      globalStartTime: start,
      globalEndTime: end,
      shipments: deliveries.map((shipment) => ({
        label: shipment.id,
        deliveries: [
          {
            label: shipment.id,
            arrivalLocation: {
              latitude: shipment.latitude!,
              longitude: shipment.longitude!,
            },
            ...(shipment.deliveryWindows.length
              ? {
                  timeWindows: shipment.deliveryWindows.map((window) => ({
                    startTime: localMinuteInstant(
                      board.plan.service_date,
                      window.startMinute,
                      timezone,
                    ),
                    endTime: localMinuteInstant(
                      board.plan.service_date,
                      window.endMinute,
                      timezone,
                    ),
                  })),
                }
              : {}),
          },
        ],
      })),
      vehicles: board.vehicles.map((vehicle) => ({
        label: vehicle.id,
        travelMode: "DRIVING",
        startLocation: {
          latitude: settings.depotLocation!.latitude,
          longitude: settings.depotLocation!.longitude,
        },
        costPerHour: 1,
      })),
      ...(rules.length ? { precedenceRules: rules } : {}),
    },
  };
}

function duration(value: unknown) {
  if (typeof value !== "string" || !value.endsWith("s"))
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  const seconds = Number(value.slice(0, -1));
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  return Math.round(seconds);
}

function integer(value: unknown) {
  // Stryker disable next-line ConditionalExpression: for every non-string input, both branches preserve the identical value for the safe-integer guard below.
  const isString = typeof value === "string";
  const parsed =
    isString &&
    value.length > 0 &&
    [...value].every((character) => "0123456789".includes(character))
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0)
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  return parsed as number;
}

function responseRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  return value as Record<string, unknown>;
}

function metrics(value: unknown): RouteMetrics {
  const item = responseRecord(value);
  return {
    travelDistanceMeters: integer(item.travelDistanceMeters ?? 0),
    travelDurationSeconds: duration(item.travelDuration ?? "0s"),
    waitDurationSeconds: duration(item.waitDuration ?? "0s"),
    totalDurationSeconds: duration(item.totalDuration ?? "0s"),
    performedShipmentCount: integer(item.performedShipmentCount ?? 0),
  };
}

const skippedReasonCodes = new Set([
  "NO_VEHICLE",
  "DEMAND_EXCEEDS_VEHICLE_CAPACITY",
  "CANNOT_BE_PERFORMED_WITHIN_VEHICLE_DISTANCE_LIMIT",
  "CANNOT_BE_PERFORMED_WITHIN_VEHICLE_DURATION_LIMIT",
  "CANNOT_BE_PERFORMED_WITHIN_VEHICLE_TRAVEL_DURATION_LIMIT",
  "CANNOT_BE_PERFORMED_WITHIN_VEHICLE_TIME_WINDOWS",
  "VEHICLE_NOT_ALLOWED",
  "VEHICLE_IGNORED",
  "SHIPMENT_IGNORED",
  "SKIPPED_IN_INJECTED_SOLUTION_CONSTRAINT",
  "VEHICLE_ROUTE_IS_FULLY_SEQUENCE_CONSTRAINED",
  "ZERO_PENALTY_COST",
]);

export function parseGoogleOptimizationResponse(
  value: unknown,
  shipmentCount: number,
  vehicleCount: number,
): GoogleOptimizationResult {
  const root = responseRecord(value);
  if (
    !Array.isArray(root.routes) ||
    (root.skippedShipments !== undefined &&
      !Array.isArray(root.skippedShipments))
  )
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  const seenShipments = new Set<number>();
  const seenVehicles = new Set<number>();
  const routes = root.routes.map((raw) => {
    const route = responseRecord(raw);
    const vehicleIndex = integer(route.vehicleIndex ?? 0);
    if (vehicleIndex >= vehicleCount || seenVehicles.has(vehicleIndex))
      throw new AppError("ROUTING_RESPONSE_INVALID", 503);
    seenVehicles.add(vehicleIndex);
    if (!Array.isArray(route.visits) || !Array.isArray(route.transitions))
      throw new AppError("ROUTING_RESPONSE_INVALID", 503);
    const routeTransitions = route.transitions;
    if (routeTransitions.length < route.visits.length)
      throw new AppError("ROUTING_RESPONSE_INVALID", 503);
    const visits = route.visits.map((rawVisit, index) => {
      const visit = responseRecord(rawVisit);
      const shipmentIndex = integer(visit.shipmentIndex ?? 0);
      if (
        shipmentIndex >= shipmentCount ||
        seenShipments.has(shipmentIndex) ||
        typeof visit.startTime !== "string" ||
        !Number.isFinite(Date.parse(visit.startTime))
      )
        throw new AppError("ROUTING_RESPONSE_INVALID", 503);
      seenShipments.add(shipmentIndex);
      const transition = (routeTransitions[index] || {}) as Record<
        string,
        unknown
      >;
      return {
        shipmentIndex,
        eta: new Date(visit.startTime).toISOString(),
        travelDistanceMeters: integer(transition.travelDistanceMeters ?? 0),
        travelDurationSeconds: duration(transition.travelDuration ?? "0s"),
        waitDurationSeconds: duration(transition.waitDuration ?? "0s"),
      };
    });
    const transitions = routeTransitions.map((rawTransition) => {
      const transition = responseRecord(rawTransition);
      const polyline = transition.routePolyline as
        Record<string, unknown> | undefined;
      return {
        encodedPolyline:
          typeof polyline?.points === "string" ? polyline.points : null,
        routeToken:
          typeof transition.routeToken === "string"
            ? transition.routeToken
            : null,
      };
    });
    const polyline = route.routePolyline as Record<string, unknown> | undefined;
    const routeMetrics = metrics(route.metrics);
    if (routeMetrics.performedShipmentCount !== visits.length)
      throw new AppError("ROUTING_RESPONSE_INVALID", 503);
    return {
      vehicleIndex,
      encodedPolyline:
        typeof polyline?.points === "string" ? polyline.points : null,
      metrics: routeMetrics,
      visits,
      transitions,
    };
  });
  const skipped = (root.skippedShipments || []).map((raw) => {
    const item = responseRecord(raw);
    const shipmentIndex = integer(item.index ?? 0);
    if (shipmentIndex >= shipmentCount || seenShipments.has(shipmentIndex))
      throw new AppError("ROUTING_RESPONSE_INVALID", 503);
    seenShipments.add(shipmentIndex);
    const reasons = Array.isArray(item.reasons)
      ? item.reasons
          .map(
            (reason) =>
              (reason as { code?: unknown } | null | undefined)?.code ?? null,
          )
          .filter((code): code is string =>
            skippedReasonCodes.has(code as string),
          )
      : [];
    return {
      shipmentIndex,
      reasons: reasons.length ? reasons : ["UNSPECIFIED"],
    };
  });
  if (seenShipments.size !== shipmentCount)
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  const aggregated = metrics(
    root.metrics &&
      (root.metrics as Record<string, unknown>).aggregatedRouteMetrics,
  );
  const performed = routes.reduce(
    (count, route) => count + route.visits.length,
    0,
  );
  if (aggregated.performedShipmentCount !== performed)
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  return {
    routes,
    skipped,
    metrics: aggregated,
  };
}

async function accessToken(credentials: GoogleServiceAccount) {
  try {
    const token = await new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    }).getAccessToken();
    if (!token) throw new Error();
    return token;
  } catch {
    throw new AppError("ROUTING_GOOGLE_DENIED", 503);
  }
}

async function limitedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError("ROUTING_GOOGLE_UNAVAILABLE", 503);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > 20 * 1024 * 1024) {
      await reader.cancel();
      throw new AppError("ROUTING_RESPONSE_INVALID", 503);
    }
    chunks.push(chunk.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  }
}

export async function requestGoogleOptimization(
  projectId: string,
  credentials: GoogleServiceAccount,
  request: GoogleOptimizationRequest,
  dependencies: {
    fetch?: typeof fetch;
    token?: (credentials: GoogleServiceAccount) => Promise<string>;
  } = {},
) {
  const timeoutSeconds = Number(request.timeout.slice(0, -1));
  let response: Response;
  try {
    response = await (dependencies.fetch || fetch)(
      `https://routeoptimization.googleapis.com/v1/projects/${encodeURIComponent(projectId)}:optimizeTours`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await (dependencies.token || accessToken)(credentials)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout((timeoutSeconds + 15) * 1000),
      },
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("ROUTING_GOOGLE_UNAVAILABLE", 503);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403)
      throw new AppError("ROUTING_GOOGLE_DENIED", 503);
    if (response.status === 429)
      throw new AppError("ROUTING_GOOGLE_QUOTA", 503);
    if (response.status === 400)
      throw new AppError("ROUTING_MODEL_REJECTED", 422);
    throw new AppError("ROUTING_GOOGLE_UNAVAILABLE", 503);
  }
  return limitedJson(response);
}
