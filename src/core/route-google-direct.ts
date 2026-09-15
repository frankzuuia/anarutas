import { AppError } from "./errors";
import type { OrderBoard, Shipment } from "./orders-contract";
import { assertDeliveryGroups } from "./route-delivery-groups";
import {
  priorityGroups,
  priorityOrder,
  routeLoads,
} from "./route-logistics-policy";
import {
  buildGoogleOptimizationRequest,
  localMinuteInstant,
  optimizationTimeoutSeconds,
  type GoogleOptimizationResult,
} from "./route-optimization-google";
import type { RoutingSettings } from "./routing-contract";

export const directFleetPolicy = "google-direct-v1-priority-transitions";

function validCoordinate(
  value: number | null,
  maximum: number,
): value is number {
  // NaN and infinities also fail this bounded comparison; null must not coerce to zero.
  return value !== null && Math.abs(value) <= maximum;
}

function normalizedWindows(shipments: Shipment[]) {
  const unique = new Map(
    shipments
      .flatMap((s) => s.deliveryWindows)
      .map((w) => [`${w.startMinute}:${w.endMinute}`, { ...w }]),
  );
  return [...unique.values()].sort(
    (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute,
  );
}

export function directDeliveryGroups(shipments: Shipment[]) {
  const byId = new Map(shipments.map((s) => [s.id, s]));
  const physical = new Map<
    string,
    {
      id: string;
      shipmentIds: string[];
      rank: number;
      latitude: number;
      longitude: number;
      windows: ReturnType<typeof normalizedWindows>;
    }
  >();
  for (const group of priorityGroups(shipments).sort(
    (a, b) => a.rank - b.rank,
  )) {
    const members = group.shipmentIds.map((id) => byId.get(id)!);
    const { latitude, longitude } = members[0];
    if (
      !validCoordinate(latitude, 90) ||
      !validCoordinate(longitude, 180) ||
      members.some(
        (s) =>
          s.locationStatus === "pending" ||
          s.latitude !== latitude ||
          s.longitude !== longitude,
      )
    )
      throw new AppError("ROUTING_POINTS_REQUIRED", 409);
    const windows = normalizedWindows(members);
    // No fuzzy distance, name matching or commercial-parent merging. Different
    // windows can require separate visits even at exactly the same coordinate.
    const key = JSON.stringify([latitude, longitude, windows]);
    const existing = physical.get(key);
    if (existing) {
      existing.shipmentIds.push(...group.shipmentIds);
      existing.rank = Math.min(existing.rank, group.rank);
    } else {
      physical.set(key, {
        ...group,
        shipmentIds: [...group.shipmentIds],
        latitude,
        longitude,
        windows,
      });
    }
  }
  return [...physical.values()];
}

export function buildDirectFleetRequest(
  board: OrderBoard,
  settings: RoutingSettings,
  timezone: string,
) {
  // Reuse the existing validated depot, civil departure, mandatory-delivery and
  // soft fleet-load contract. No network calls or measured local warm start.
  const request = buildGoogleOptimizationRequest(board, settings, timezone);
  const groups = directDeliveryGroups(board.shipments);
  const start = Date.parse(request.model.globalStartTime);
  const end = request.model.globalEndTime;
  const orders = groups.reduce(
    (count, group) => count + group.shipmentIds.length,
    0,
  );
  const lateCost =
    (request.model.globalDurationCostPerHour + 1) *
    (orders + groups.length + 1);
  const tag = (rank: number) => `priority:${priorityOrder[rank]}`;
  request.timeout = `${optimizationTimeoutSeconds(groups.length)}s`;
  request.model.shipments = groups.map((group) => ({
    label: group.id,
    loadDemands: {
      orders: { amount: String(group.shipmentIds.length) },
      destinations: { amount: "1" },
    },
    deliveries: (group.windows.length ? group.windows : [null]).map(
      (window) => ({
        label: group.id,
        tags: [tag(group.rank)],
        arrivalLocation: {
          latitude: group.latitude,
          longitude: group.longitude,
        },
        ...(window
          ? {
              timeWindows: [
                {
                  startTime: new Date(
                    Math.max(
                      start,
                      Date.parse(
                        localMinuteInstant(
                          board.plan.service_date,
                          window.startMinute,
                          timezone,
                        ),
                      ),
                    ),
                  ).toISOString(),
                  endTime: end,
                  softEndTime: new Date(
                    Math.max(
                      start,
                      Date.parse(
                        localMinuteInstant(
                          board.plan.service_date,
                          window.endMinute,
                          timezone,
                        ),
                      ),
                    ),
                  ).toISOString(),
                  costPerHourAfterSoftEndTime:
                    lateCost * (priorityOrder.length - group.rank),
                },
              ],
            }
          : {}),
      }),
    ),
  }));
  for (const vehicle of request.model.vehicles)
    vehicle.loadLimits.destinations.softMaxLoad = String(
      Math.ceil(groups.length / board.vehicles.length),
    );

  const ranks = [...new Set(groups.map((group) => group.rank))];
  const windowHours = Math.max(
    1,
    ...groups.flatMap((group) =>
      group.windows.map(
        (window) =>
          (Date.parse(
            localMinuteInstant(
              board.plan.service_date,
              window.endMinute,
              timezone,
            ),
          ) -
            start) /
          3_600_000,
      ),
    ),
  );
  // A reversal costs the whole batch's reference-window lateness at the affected
  // priority. This is a strong FINITE preference, expressed in objective units,
  // not money, a hard time constraint, or a post-solver rejection. At most three
  // directed tag pairs for the current tiers, independent of order/vehicle count.
  const priorityCost = lateCost * windowHours * (groups.length + 1);
  request.model.transitionAttributes = ranks.flatMap((from) =>
    ranks
      .filter((to) => to < from)
      .map((to) => ({
        srcTag: tag(from),
        dstTag: tag(to),
        cost: priorityCost * (from - to),
      })),
  );
  return { request, groups };
}

function lateness(
  shipment: Shipment,
  eta: string,
  date: string,
  timezone: string,
) {
  const arrival = Date.parse(eta);
  const windows = shipment.deliveryWindows.map((window) => ({
    start: Date.parse(localMinuteInstant(date, window.startMinute, timezone)),
    end: Date.parse(localMinuteInstant(date, window.endMinute, timezone)),
  }));
  if (
    !windows.length ||
    windows.some((w) => arrival >= w.start && arrival <= w.end)
  )
    return 0;
  const previous = windows.filter((w) => w.end < arrival);
  return previous.length
    ? Math.ceil((arrival - Math.max(...previous.map((w) => w.end))) / 1000)
    : 0;
}

export function expandDirectFleetResult(
  board: OrderBoard,
  groups: ReturnType<typeof directDeliveryGroups>,
  result: GoogleOptimizationResult,
  timezone: string,
): GoogleOptimizationResult {
  if (result.skipped.length)
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  const deliveries = board.shipments.filter(
    (s) => s.fulfillmentMode === "delivery" && !s.customerArchived,
  );
  const indices = new Map(deliveries.map((s, index) => [s.id, index]));
  const seen = new Set<string>();
  const vehicles = new Set<number>();
  const routes = result.routes.map((route) => {
    if (!board.vehicles[route.vehicleIndex] || vehicles.has(route.vehicleIndex))
      throw new AppError("ROUTING_RESPONSE_INVALID", 503);
    vehicles.add(route.vehicleIndex);
    if (
      route.visits.length &&
      route.transitions.length !== route.visits.length + 1
    )
      throw new AppError("ROUTING_RESPONSE_INVALID", 503, {
        field: "route.returnTransition",
      });
    let previousRank = -1;
    let previousTime = Date.parse(
      route.departureAt ?? route.visits[0]?.eta ?? "",
    );
    const transitions: typeof route.transitions = [];
    const visits = route.visits.flatMap((visit, position) => {
      const group = groups[visit.shipmentIndex];
      const instant = Date.parse(visit.eta);
      if (
        !group ||
        !Number.isFinite(instant) ||
        instant < previousTime ||
        (route.finishedAt !== undefined &&
          instant > Date.parse(route.finishedAt))
      )
        throw new AppError("ROUTING_RESPONSE_INVALID", 503);
      previousTime = instant;
      const priorityConflict = group.rank < previousRank;
      previousRank = Math.max(previousRank, group.rank);
      return group.shipmentIds.map((id, memberIndex) => {
        const shipmentIndex = indices.get(id);
        if (shipmentIndex === undefined || seen.has(id))
          throw new AppError("ROUTING_RESPONSE_INVALID", 503);
        seen.add(id);
        transitions.push(
          memberIndex === 0
            ? route.transitions[position]
            : { encodedPolyline: null, routeToken: null },
        );
        return {
          ...visit,
          shipmentIndex,
          travelDistanceMeters:
            memberIndex === 0 ? visit.travelDistanceMeters : 0,
          travelDurationSeconds:
            memberIndex === 0 ? visit.travelDurationSeconds : 0,
          waitDurationSeconds:
            memberIndex === 0 ? visit.waitDurationSeconds : 0,
          lateSeconds: lateness(
            deliveries[shipmentIndex],
            visit.eta,
            board.plan.service_date,
            timezone,
          ),
          priorityConflict,
        };
      });
    });
    if (route.visits.length) transitions.push(route.transitions.at(-1)!);
    return {
      ...route,
      visits,
      transitions,
      metrics: { ...route.metrics, performedShipmentCount: visits.length },
    };
  });
  if (seen.size !== deliveries.length)
    throw new AppError("ROUTING_RESPONSE_INVALID", 503, {
      field: "shipments.completeCoverage",
    });
  assertDeliveryGroups(
    board.shipments,
    routes.map((route) => ({
      vehicleId: board.vehicles[route.vehicleIndex].id,
      shipmentIds: route.visits.map(
        (visit) => deliveries[visit.shipmentIndex].id,
      ),
    })),
  );
  return {
    ...result,
    routes,
    metrics: { ...result.metrics, performedShipmentCount: seen.size },
  };
}

export function directFleetDiagnostics(
  board: OrderBoard,
  result: GoogleOptimizationResult,
) {
  const deliveries = board.shipments.filter(
    (s) => s.fulfillmentMode === "delivery" && !s.customerArchived,
  );
  const candidate = {
    routes: board.vehicles.map((vehicle, index) => ({
      vehicleId: vehicle.id,
      shipmentIds:
        result.routes
          .find((route) => route.vehicleIndex === index)
          ?.visits.map((visit) => deliveries[visit.shipmentIndex].id) ?? [],
    })),
  };
  const load = routeLoads(board.shipments, candidate);
  const visits = new Map(
    result.routes
      .flatMap((route) => route.visits)
      .map((visit) => [deliveries[visit.shipmentIndex].id, visit]),
  );
  const stops = priorityGroups(deliveries).map((group) =>
    visits.get(group.id)!,
  );
  const makespanSeconds = Math.max(
    0,
    ...result.routes.map((route) => route.metrics.totalDurationSeconds),
  );
  return {
    ordersPerRoute: load.routes.map((route) => route.orders),
    destinationsPerRoute: load.routes.map((route) => route.destinations),
    lateStops: stops.filter((stop) => (stop.lateSeconds ?? 0) > 0).length,
    lateSeconds: stops.reduce(
      (total, stop) => total + (stop.lateSeconds ?? 0),
      0,
    ),
    priorityConflicts: stops.filter((stop) => stop.priorityConflict).length,
    unusedVehicles: load.routes.filter((route) => route.orders === 0).length,
    operationalSeconds: result.metrics.travelDurationSeconds + makespanSeconds,
    travelSeconds: result.metrics.travelDurationSeconds,
    makespanSeconds,
    distanceMeters: result.metrics.travelDistanceMeters,
    maxOrders: load.maxOrders,
    orderImbalance: load.orderImbalance,
  };
}
