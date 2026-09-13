import type { OrderBoard, Shipment } from "./orders-contract";
import { deliveryGroups } from "./route-delivery-groups";

export const logisticsPolicyVersion = "priority-road-sequenced-v4";
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

export function routeLoads(shipments: Shipment[], candidate: RoutingCandidate) {
  const groupByShipment = new Map(
    deliveryGroups(shipments).flatMap((group) =>
      group.shipmentIds.map((id) => [id, group.id] as const),
    ),
  );
  const routes = candidate.routes.map((route) => ({
    vehicleId: route.vehicleId,
    orders: route.shipmentIds.length,
    destinations: new Set(
      route.shipmentIds.map((id) => groupByShipment.get(id)),
    ).size,
  }));
  const orders = routes.map((route) => route.orders);
  const destinations = routes.map((route) => route.destinations);
  return {
    routes,
    maxOrders: Math.max(0, ...orders),
    orderImbalance: orders.length
      ? Math.max(...orders) - Math.min(...orders)
      : 0,
    maxDestinations: Math.max(0, ...destinations),
    destinationImbalance: destinations.length
      ? Math.max(...destinations) - Math.min(...destinations)
      : 0,
  };
}

// Largest indivisible destinations go first to the least-loaded vehicle. This is
// an attainable measured baseline, not a capacity limit or claim of optimality.
export function balancedCandidate(
  shipments: Shipment[],
  vehicleIds: string[],
): RoutingCandidate {
  const groups = priorityGroups(shipments).sort(
    (a, b) => b.shipmentIds.length - a.shipmentIds.length || a.rank - b.rank,
  );
  const routes = vehicleIds.map((vehicleId) => ({
    vehicleId,
    shipmentIds: [] as string[],
    orders: 0,
  }));
  for (const group of groups) {
    const route = [...routes].sort((a, b) => a.orders - b.orders)[0];
    route.shipmentIds.push(...group.shipmentIds);
    route.orders += group.shipmentIds.length;
  }
  return {
    routes: routes.map(({ vehicleId, shipmentIds }) => ({
      vehicleId,
      shipmentIds,
    })),
  };
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
  "maxOrders",
  "orderImbalance",
  "maxDestinations",
  "destinationImbalance",
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
