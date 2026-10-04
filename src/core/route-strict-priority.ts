import { AppError } from "./errors";
import type { OrderBoard } from "./orders-contract";
import {
  evaluateRoutingCandidate,
  parseRoutingCandidate,
} from "./route-candidate-evaluator";
import {
  priorityConflictIds,
  priorityGroups,
  type RoutingCandidate,
} from "./route-logistics-policy";
import type { GoogleOptimizationResult } from "./route-optimization-google";
import { createRoadLegReader, emptyMetrics } from "./route-road";
import { physicalVisitKey } from "./route-service-time";
import type { RoutingSettings } from "./routing-contract";

function assertPointOwners(board: OrderBoard, candidate: RoutingCandidate) {
  const shipments = new Map(board.shipments.map((s) => [s.id, s]));
  const owners = new Map<string, string>();
  for (const route of candidate.routes)
    for (const id of route.shipmentIds) {
      const key = physicalVisitKey(shipments.get(id)!);
      const owner = owners.get(key);
      if (owner !== undefined && owner !== route.vehicleId)
        throw new AppError("ROUTING_RESPONSE_INVALID", 503, {
          field: "route.physicalPointOwner",
        });
      owners.set(key, route.vehicleId);
    }
}

// Expanded results use individual delivery indices, not Fleet's physical groups.
// Validate the complete fleet before deriving any order or measurement request.
export function expandedRoutingCandidate(
  board: OrderBoard,
  result: GoogleOptimizationResult,
): RoutingCandidate {
  const deliveries = board.shipments.filter(
    (s) => s.fulfillmentMode === "delivery" && !s.customerArchived,
  );
  const routes = new Map<string, string[]>();
  if (result.skipped.length)
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  for (const route of result.routes) {
    const vehicle = board.vehicles[route.vehicleIndex];
    if (
      !Number.isSafeInteger(route.vehicleIndex) ||
      !vehicle ||
      routes.has(vehicle.id)
    )
      throw new AppError("ROUTING_RESPONSE_INVALID", 503);
    routes.set(
      vehicle.id,
      route.visits.map((visit) => {
        const shipment = deliveries[visit.shipmentIndex];
        if (!Number.isSafeInteger(visit.shipmentIndex) || !shipment)
          throw new AppError("ROUTING_RESPONSE_INVALID", 503);
        return shipment.id;
      }),
    );
  }
  const candidate = parseRoutingCandidate(
    {
      routes: board.vehicles.map((v) => ({
        vehicleId: v.id,
        shipmentIds: routes.get(v.id) ?? [],
      })),
    },
    board,
  );
  assertPointOwners(board, candidate);
  return candidate;
}

export function prioritizeRoutingCandidate(
  board: OrderBoard,
  candidate: RoutingCandidate,
): RoutingCandidate {
  candidate = parseRoutingCandidate(candidate, board);
  assertPointOwners(board, candidate);
  const ranks = new Map(
    priorityGroups(board.shipments).flatMap((group) =>
      group.shipmentIds.map((id) => [id, group.rank] as const),
    ),
  );
  const points = new Map(
    board.shipments.map((s) => [s.id, physicalVisitKey(s)]),
  );
  return {
    routes: candidate.routes.map((route) => {
      // Stable sorting keeps Google's relative order within each priority tier,
      // and each shipping customer's orders stay contiguous as one delivery.
      let shipmentIds = [...route.shipmentIds].sort(
        (left, right) => ranks.get(left)! - ranks.get(right)!,
      );
      // At a tier boundary, a lower-priority client can share the current visit
      // once all preceding priorities are done. Compact only when the complete
      // route remains nondecreasing; otherwise its required revisit stays.
      for (const point of new Set(shipmentIds.map((id) => points.get(id)!))) {
        const members = shipmentIds.filter((id) => points.get(id) === point);
        if (members.length < 2) continue;
        const first = shipmentIds.indexOf(members[0]);
        const proposed = [
          ...shipmentIds.slice(0, first),
          ...members,
          ...shipmentIds.slice(first).filter((id) => points.get(id) !== point),
        ];
        if (
          proposed.every(
            (id, index) =>
              index === 0 || ranks.get(proposed[index - 1])! <= ranks.get(id)!,
          )
        )
          shipmentIds = proposed;
      }
      return { ...route, shipmentIds };
    }),
  };
}

export function assertStrictPriorityResult(
  board: OrderBoard,
  result: GoogleOptimizationResult,
) {
  const candidate = expandedRoutingCandidate(board, result);
  if (priorityConflictIds(board.shipments, candidate).size)
    throw new AppError("ROUTING_RESPONSE_INVALID", 503, {
      field: "route.customerPriority",
    });
}

export function asOptimizationResult(
  evaluation: Awaited<ReturnType<typeof evaluateRoutingCandidate>>,
  original: OrderBoard,
): GoogleOptimizationResult {
  const deliveries = original.shipments.filter(
    (s) => s.fulfillmentMode === "delivery" && !s.customerArchived,
  );
  const shipmentIndex = new Map(deliveries.map((s, index) => [s.id, index]));
  const vehicleIndex = new Map(
    original.vehicles.map((v, index) => [v.id, index]),
  );
  return {
    metrics: evaluation.result.metrics,
    skipped: [],
    routes: evaluation.result.routes.map((route) => ({
      vehicleIndex: vehicleIndex.get(route.vehicleId)!,
      departureAt: route.departureAt,
      finishedAt: route.finishedAt,
      encodedPolyline: null,
      trafficMode: route.trafficMode,
      metrics: route.metrics,
      transitions: route.transitions,
      visits: route.stops.map((stop) => ({
        shipmentIndex: shipmentIndex.get(stop.shipmentId)!,
        eta: stop.eta,
        travelDistanceMeters: stop.travelDistanceMeters,
        travelDurationSeconds: stop.travelDurationSeconds,
        waitDurationSeconds: stop.waitDurationSeconds,
        lateSeconds: stop.lateSeconds,
        priorityConflict: stop.priorityConflict,
      })),
    })),
  };
}

export async function reconcileStrictPriorities(
  board: OrderBoard,
  result: GoogleOptimizationResult,
  settings: RoutingSettings,
  timezone: string,
  onProgress: () => Promise<void> = async () => {},
  readLeg = createRoadLegReader(),
) {
  const incoming = expandedRoutingCandidate(board, result);
  const ordered = prioritizeRoutingCandidate(board, incoming);
  const changed = ordered.routes.filter((route, index) =>
    route.shipmentIds.some(
      (id, position) => id !== incoming.routes[index].shipmentIds[position],
    ),
  );
  if (!changed.length) {
    assertStrictPriorityResult(board, result);
    return { result, reorderedVehicleIds: [] as string[] };
  }
  const vehicleIds = new Set(changed.map((route) => route.vehicleId));
  const shipmentIds = new Set(changed.flatMap((route) => route.shipmentIds));
  // Leave compliant routes, their Google clocks and their private road traces
  // untouched. Only the changed vehicles incur new Routes measurements.
  const subset: OrderBoard = {
    ...board,
    vehicles: board.vehicles.filter((v) => vehicleIds.has(v.id)),
    shipments: board.shipments.filter((s) => shipmentIds.has(s.id)),
  };
  const evaluation = await evaluateRoutingCandidate(
    subset,
    { routes: changed },
    settings,
    timezone,
    onProgress,
    readLeg,
  );
  const measured = asOptimizationResult(evaluation, board);
  const replacements = new Map(
    measured.routes.map((route) => [route.vehicleIndex, route]),
  );
  const routes = result.routes.map(
    (route) => replacements.get(route.vehicleIndex) ?? route,
  );
  const metrics = emptyMetrics();
  for (const route of routes)
    for (const key of Object.keys(metrics) as (keyof typeof metrics)[])
      metrics[key] += route.metrics[key];
  const corrected = { ...result, routes, metrics };
  assertStrictPriorityResult(board, corrected);
  return { result: corrected, reorderedVehicleIds: [...vehicleIds] };
}
