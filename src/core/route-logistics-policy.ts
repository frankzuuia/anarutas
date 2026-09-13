import type { OrderBoard, Shipment } from "./orders-contract";
import { deliveryGroups } from "./route-delivery-groups";

export const logisticsPolicyVersion = "priority-per-route-v1";
export const priorityOrder = ["high", "medium", "schedule"] as const;
export type RoutingCandidate = {
  routes: { vehicleId: string; shipmentIds: string[] }[];
};

export function priorityGroups(shipments: Shipment[]) {
  const byId = new Map(shipments.map((shipment) => [shipment.id, shipment]));
  return deliveryGroups(shipments).map((group) => {
    const members = group.shipmentIds.map((id) => byId.get(id)!);
    const rank = Math.min(
      ...members.map((s) => priorityOrder.indexOf(s.priority)),
    );
    return { ...group, rank, priority: priorityOrder[rank] };
  });
}

// Applies the operator's explicit precedence, not a heuristic assignment. The
// model still chooses trucks and the sequence within each priority tier.
export function prioritizeCandidate(
  shipments: Shipment[],
  candidate: RoutingCandidate,
): RoutingCandidate {
  const groups = priorityGroups(shipments);
  const byShipment = new Map(
    groups.flatMap((g) => g.shipmentIds.map((id) => [id, g] as const)),
  );
  return {
    routes: candidate.routes.map((route) => {
      const orderedGroups = [
        ...new Set(route.shipmentIds.map((id) => byShipment.get(id)!)),
      ];
      return {
        vehicleId: route.vehicleId,
        shipmentIds: orderedGroups
          .sort((a, b) => a.rank - b.rank)
          .flatMap((g) => g.shipmentIds),
      };
    }),
  };
}

export function priorityConflictIds(
  shipments: Shipment[],
  candidate: RoutingCandidate,
) {
  const byShipment = new Map(
    priorityGroups(shipments).flatMap((g) =>
      g.shipmentIds.map((id) => [id, g] as const),
    ),
  );
  const conflicts = new Set<string>();
  for (const route of candidate.routes) {
    let previousRank = -1;
    for (const group of new Set(
      route.shipmentIds.map((id) => byShipment.get(id)!),
    )) {
      if (group.rank < previousRank)
        group.shipmentIds.forEach((id) => conflicts.add(id));
      previousRank = Math.max(previousRank, group.rank);
    }
  }
  return conflicts;
}

// Trucks currently have no distinct routing capabilities. Merely swapping lane
// names, or the order of the tool's route array, is not a logistics alternative.
export function logisticsSignature(candidate: RoutingCandidate) {
  return JSON.stringify(
    candidate.routes
      .map((route) => route.shipmentIds)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}

export function hasRoutingAlternatives(board: OrderBoard) {
  const groups = priorityGroups(board.shipments);
  if (groups.length < 2) return false;
  if (board.vehicles.length > 1) return true;
  return new Set(groups.map((group) => group.rank)).size < groups.length;
}

export const logisticsScoreKeys = [
  "priorityConflicts",
  "lateStops",
  "lateSeconds",
  "unusedVehicles",
  "makespanSeconds",
  "imbalanceSeconds",
  "waitSeconds",
  "travelSeconds",
  "distanceMeters",
] as const;
export type LogisticsScore = Record<
  (typeof logisticsScoreKeys)[number],
  number
>;

export function compareLogisticsScores(a: LogisticsScore, b: LogisticsScore) {
  for (const key of logisticsScoreKeys) {
    const difference = a[key] - b[key];
    if (difference) return difference;
  }
  return 0;
}
