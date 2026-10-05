import { AppError } from "./errors";
import { physicalVisitKey, visitServiceSeconds } from "./route-service-time";
import { receivingWindows } from "./route-reception";
import { visitWindowAlternatives } from "./route-visit-windows";
import { geographicZones, zoneVehicleCosts } from "./route-zones";
import {
  assertFleetBusinessConstraints,
  bindPhysicalPointOwners,
  strictPriorityTransitions,
} from "./route-fleet-constraints";
import type { OrderBoard, Shipment } from "./orders-contract";
import { assertDeliveryGroups } from "./route-delivery-groups";
import {
  priorityConflictIds,
  priorityGroups,
  priorityOrder,
  routeLoads,
} from "./route-logistics-policy";
import {
  buildGoogleOptimizationRequest,
  localMinuteInstant,
  optimizationTimeoutSeconds,
  type GoogleOptimizationResult,
  type GoogleOptimizationRequest,
} from "./route-optimization-google";
import { expandedRoutingCandidate } from "./route-strict-priority";
import type { RoutingSettings } from "./routing-contract";

export const directFleetPolicy = "google-zones-v7-joint-priority";

function validCoordinate(
  value: number | null,
  maximum: number,
): value is number {
  // NaN and infinities also fail this bounded comparison; null must not coerce to zero.
  return value !== null && Math.abs(value) <= maximum;
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
      windows: Shipment["deliveryWindows"];
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
    const windows = receivingWindows(members);
    // Equal-priority clients at an exact point can share a visit. Different
    // priorities remain visible to the joint solver, with one vehicle owner.
    const key = JSON.stringify([physicalVisitKey(members[0]), group.rank]);
    const existing = physical.get(key);
    if (existing) {
      existing.shipmentIds.push(...group.shipmentIds);
      existing.windows = receivingWindows(
        existing.shipmentIds.map((id) => byId.get(id)!),
      );
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
  const zones = geographicZones(
    groups,
    board.vehicles.map((v) => v.id),
    settings.depotLocation!,
  );
  const geographicCosts = zoneVehicleCosts(
    groups,
    zones,
    board.vehicles.map((v) => v.id),
  );
  const byId = new Map(board.shipments.map((s) => [s.id, s]));
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
  request.timeout = `${optimizationTimeoutSeconds(groups.length)}s`;
  request.model.shipments = groups.map((group) => ({
    label: group.id,
    costsPerVehicle: geographicCosts.get(group.id)!,
    loadDemands: {
      orders: { amount: String(group.shipmentIds.length) },
      destinations: { amount: "1" },
    },
    deliveries: visitWindowAlternatives(
      group.windows.map((window) => ({
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
      { startTime: request.model.globalStartTime, endTime: end },
      lateCost * (priorityOrder.length - group.rank),
      windowHours,
    ).map((timing) => ({
      label: group.id,
      duration: `${visitServiceSeconds(group.shipmentIds.map((id) => byId.get(id)!))}s`,
      tags: [tag(group.rank)],
      arrivalLocation: {
        latitude: group.latitude,
        longitude: group.longitude,
      },
      ...timing,
    })),
  }));
  for (const vehicle of request.model.vehicles) {
    // Include unloading and waiting as well as travel, using the existing time
    // objective's unit. Global duration still minimizes the latest depot return.
    vehicle.costPerHour = vehicle.costPerTraveledHour;
    vehicle.loadLimits.destinations.softMaxLoad = String(
      Math.ceil(groups.length / board.vehicles.length),
    );
  }

  request.model.transitionAttributes = strictPriorityTransitions(
    groups,
    request.model,
  );
  bindPhysicalPointOwners(groups, request.model);
  return { request, groups, zones };
}

export function assertDirectFleetResponse(
  request: GoogleOptimizationRequest,
  result: GoogleOptimizationResult,
) {
  assertFleetBusinessConstraints(request, result);
  for (const route of result.routes) {
    if (
      !Number.isSafeInteger(route.vehicleIndex) ||
      !request.model.vehicles[route.vehicleIndex]
    )
      throw new AppError("ROUTING_RESPONSE_INVALID", 503, {
        field: "route.vehicle",
      });
    for (let index = 0; index < route.visits.length; index++) {
      const visit = route.visits[index];
      const shipment = request.model.shipments[visit.shipmentIndex];
      if (
        !shipment ||
        (shipment.allowedVehicleIndices?.length &&
          !shipment.allowedVehicleIndices.includes(route.vehicleIndex))
      )
        throw new AppError("ROUTING_RESPONSE_INVALID", 503, {
          field: "route.zone",
        });
      // All alternatives at a physical stop share the same service duration.
      const seconds = Number(shipment.deliveries[0].duration!.slice(0, -1));
      const next = route.visits[index + 1]?.eta ?? route.finishedAt;
      if (
        next !== undefined &&
        Date.parse(next) < Date.parse(visit.eta) + seconds * 1000
      )
        throw new AppError("ROUTING_RESPONSE_INVALID", 503, {
          field: "route.serviceDuration",
        });
    }
  }
}

function lateness(
  shipment: Shipment,
  eta: string,
  date: string,
  timezone: string,
) {
  const arrival = Date.parse(eta);
  const [window] = receivingWindows([shipment]);
  if (!window) return 0;
  const closing = Date.parse(
    localMinuteInstant(date, window.endMinute, timezone),
  );
  return Math.max(0, Math.ceil((arrival - closing) / 1000));
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
          priorityConflict: false,
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
  const expanded = {
    ...result,
    routes,
    metrics: { ...result.metrics, performedShipmentCount: seen.size },
  };
  const conflicts = priorityConflictIds(
    board.shipments,
    expandedRoutingCandidate(board, expanded),
  );
  for (const route of routes)
    for (const visit of route.visits)
      visit.priorityConflict = conflicts.has(
        deliveries[visit.shipmentIndex].id,
      );
  return expanded;
}

export function directFleetDiagnostics(
  board: OrderBoard,
  result: GoogleOptimizationResult,
) {
  const deliveries = board.shipments.filter(
    (s) => s.fulfillmentMode === "delivery" && !s.customerArchived,
  );
  const candidate = expandedRoutingCandidate(board, result);
  const conflicts = priorityConflictIds(board.shipments, candidate);
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
    priorityConflicts: priorityGroups(deliveries).filter((group) =>
      conflicts.has(group.id),
    ).length,
    unusedVehicles: load.routes.filter((route) => route.orders === 0).length,
    operationalSeconds: result.metrics.travelDurationSeconds + makespanSeconds,
    travelSeconds: result.metrics.travelDurationSeconds,
    trafficAdjustmentSeconds: result.routes.reduce(
      (total, route) => total + (route.trafficAdjustmentSeconds ?? 0),
      0,
    ),
    makespanSeconds,
    distanceMeters: result.metrics.travelDistanceMeters,
    maxOrders: load.maxOrders,
    orderImbalance: load.orderImbalance,
  };
}
