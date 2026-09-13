import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import type { OrderBoard, Shipment } from "./orders-contract";
import { assertDeliveryGroups, deliveryGroups } from "./route-delivery-groups";
import type { GoogleOptimizationResult } from "./route-optimization-google";
import {
  hasRoutingAlternatives,
  logisticsPolicyVersion,
  logisticsScoreKeys,
  priorityGroups,
  routeLoads,
  type LogisticsScore,
  type RoutingCandidate,
} from "./route-logistics-policy";
import { calculateManualRoutes, createRoadLegReader } from "./route-road";
import { getRoutingSettings } from "./routing-settings";

export type CandidateEvaluation = {
  id: string;
  timezone: string;
  candidate: RoutingCandidate;
  board: OrderBoard;
  result: Awaited<ReturnType<typeof calculateManualRoutes>>;
  feasible: boolean;
  score: LogisticsScore;
  lateStops: number;
  priorityConflicts: number;
  unusedVehicles: number;
  imbalanceSeconds: number;
  load: ReturnType<typeof routeLoads>;
};

function candidateRecord(value: unknown): Record<string, unknown> {
  if (!value || Array.isArray(value))
    throw new AppError("ROUTING_CANDIDATE_INVALID", 503);
  return value as Record<string, unknown>;
}

export function parseRoutingCandidate(
  value: unknown,
  board: OrderBoard,
): RoutingCandidate {
  const root = candidateRecord(value);
  if (
    !Array.isArray(root.routes) ||
    root.routes.length !== board.vehicles.length
  )
    throw new AppError("ROUTING_CANDIDATE_INVALID", 503);
  const vehicles = new Set(board.vehicles.map((vehicle) => vehicle.id));
  const deliveries = board.shipments.filter(
    (shipment) =>
      shipment.fulfillmentMode === "delivery" && !shipment.customerArchived,
  );
  const expected = new Set(deliveries.map((shipment) => shipment.id));
  const usedVehicles = new Set<string>();
  const usedShipments = new Set<string>();
  const routes = root.routes.map((raw) => {
    const route = candidateRecord(raw);
    const vehicleId = route.vehicleId as string;
    if (
      !vehicles.has(vehicleId) ||
      usedVehicles.has(vehicleId) ||
      !Array.isArray(route.shipmentIds)
    )
      throw new AppError("ROUTING_CANDIDATE_INVALID", 503);
    usedVehicles.add(vehicleId);
    const shipmentIds = route.shipmentIds.map((id) => {
      const shipmentId = id as string;
      if (!expected.has(shipmentId) || usedShipments.has(shipmentId))
        throw new AppError("ROUTING_CANDIDATE_INVALID", 503);
      usedShipments.add(shipmentId);
      return shipmentId;
    });
    return { vehicleId, shipmentIds };
  });
  if (usedShipments.size !== expected.size)
    throw new AppError("ROUTING_CANDIDATE_INVALID", 503);
  assertDeliveryGroups(deliveries, routes);
  return { routes };
}

function candidateBoard(
  source: OrderBoard,
  candidate: RoutingCandidate,
): OrderBoard {
  const byId = new Map(
    source.shipments.map((shipment) => [shipment.id, shipment]),
  );
  const planned: Shipment[] = candidate.routes.flatMap((route) =>
    route.shipmentIds.map((id, index) => ({
      ...byId.get(id)!,
      vehicle_id: route.vehicleId,
      position: index + 1,
    })),
  );
  const plannedIds = new Set(planned.map((shipment) => shipment.id));
  return {
    ...source,
    shipments: [
      ...planned,
      ...source.shipments.filter((shipment) => !plannedIds.has(shipment.id)),
    ],
  };
}

export async function evaluateRoutingCandidate(
  board: OrderBoard,
  candidate: RoutingCandidate,
  settings: Awaited<ReturnType<typeof getRoutingSettings>>,
  timezone: string,
  onProgress: () => Promise<void> = async () => {},
  readLeg = createRoadLegReader(),
): Promise<CandidateEvaluation> {
  candidate = parseRoutingCandidate(candidate, board);
  const planned = candidateBoard(board, candidate);
  const result = await calculateManualRoutes(
    planned,
    settings,
    timezone,
    onProgress,
    readLeg,
  );
  const byId = new Map(
    result.routes
      .flatMap((route) => route.stops)
      .map((stop) => [stop.shipmentId, stop]),
  );
  const stops = deliveryGroups(board.shipments).map((group) => ({
    lateSeconds: Math.max(
      ...group.shipmentIds.map((id) => byId.get(id)!.lateSeconds ?? 0),
    ),
    priorityConflict: byId.get(group.id)!.priorityConflict,
  }));
  const lateStops = stops.filter((stop) => stop.lateSeconds > 0).length;
  const lateSeconds = stops.reduce(
    (total, stop) => total + stop.lateSeconds,
    0,
  );
  const priorityConflicts = stops.filter(
    (stop) => stop.priorityConflict,
  ).length;
  const active = result.routes.filter((route) => route.stops.length);
  const durations = active.map((route) => route.metrics.totalDurationSeconds);
  const imbalanceSeconds = durations.length
    ? Math.max(...durations) - Math.min(...durations)
    : 0;
  const unusedVehicles =
    deliveryGroups(board.shipments).length >= board.vehicles.length
      ? result.routes.filter((route) => !route.stops.length).length
      : 0;
  const load = routeLoads(board.shipments, candidate);
  return {
    id: randomUUID(),
    timezone,
    candidate,
    board: planned,
    result,
    feasible: true,
    lateStops,
    priorityConflicts,
    unusedVehicles,
    imbalanceSeconds,
    load,
    score: {
      priorityConflicts,
      lateStops,
      lateSeconds,
      unusedVehicles,
      maxOrders: load.maxOrders,
      orderImbalance: load.orderImbalance,
      maxDestinations: load.maxDestinations,
      destinationImbalance: load.destinationImbalance,
      makespanSeconds: Math.max(0, ...durations),
      imbalanceSeconds,
      waitSeconds: result.metrics.waitDurationSeconds,
      travelSeconds: result.metrics.travelDurationSeconds,
      distanceMeters: result.metrics.travelDistanceMeters,
    },
  };
}

export function deterministicPlanningSnapshot(
  board: OrderBoard,
  settings: Awaited<ReturnType<typeof getRoutingSettings>>,
  timezone: string,
) {
  const groups = priorityGroups(board.shipments);
  return {
    planId: board.plan.id,
    serviceDate: board.plan.service_date,
    timezone,
    departureMinute: board.plan.departure_minute,
    depot: settings.depotLocation,
    vehicles: board.vehicles.map((vehicle) => ({ id: vehicle.id })),
    policy: {
      version: logisticsPolicyVersion,
      priorityScope: "per_vehicle",
      scoreOrder: logisticsScoreKeys,
      compareAlternatives: hasRoutingAlternatives(board),
    },
    deliveryGroups: groups,
    shipments: board.shipments
      .filter(
        (shipment) =>
          shipment.fulfillmentMode === "delivery" && !shipment.customerArchived,
      )
      .map((shipment) => ({
        id: shipment.id,
        latitude: shipment.latitude,
        longitude: shipment.longitude,
        priority: shipment.priority,
        windows: shipment.deliveryWindows,
      })),
  };
}

export function googleProposalCandidate(
  board: OrderBoard,
  result: GoogleOptimizationResult,
): RoutingCandidate {
  const groups = deliveryGroups(board.shipments);
  return {
    routes: board.vehicles.map((vehicle, vehicleIndex) => ({
      vehicleId: vehicle.id,
      shipmentIds:
        result.routes
          .find((route) => route.vehicleIndex === vehicleIndex)
          ?.visits.flatMap(
            (visit) => groups[visit.shipmentIndex].shipmentIds,
          ) ?? [],
    })),
  };
}
