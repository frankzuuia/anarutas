import type { OrderBoard } from "./orders-contract";
import {
  logisticsSignature,
  priorityGroups,
  type RoutingCandidate,
} from "./route-logistics-policy";

// A partition ignores truck labels and visit order, but not destination IDs.
// This separates changing the fleet allocation from optimizing its visit order.
export function allocationSignature(candidate: RoutingCandidate) {
  return logisticsSignature({
    routes: candidate.routes.map((route) => ({
      ...route,
      shipmentIds: [...route.shipmentIds].sort(),
    })),
  });
}

export function logisticsComparison(
  board: OrderBoard,
  best: RoutingCandidate,
  measured: RoutingCandidate[],
) {
  const groups = priorityGroups(board.shipments);
  const byShipment = new Map(
    groups.flatMap((group) =>
      group.shipmentIds.map((id) => [id, group] as const),
    ),
  );
  const required = {
    assignment: groups.length > 1 && board.vehicles.length > 1,
    sequence: best.routes.some((route) => {
      const routeGroups = [
        ...new Set(route.shipmentIds.map((id) => byShipment.get(id)!)),
      ];
      return (
        new Set(routeGroups.map((group) => group.rank)).size <
        routeGroups.length
      );
    }),
  };
  const bestAllocation = allocationSignature(best);
  const bestSequence = logisticsSignature(best);
  const observed = { assignment: false, sequence: false };
  for (const candidate of measured) {
    const sameAllocation = allocationSignature(candidate) === bestAllocation;
    observed.assignment ||= !sameAllocation;
    observed.sequence ||=
      sameAllocation && logisticsSignature(candidate) !== bestSequence;
  }
  const missing = (Object.keys(required) as (keyof typeof required)[]).filter(
    (key) => required[key] && !observed[key],
  );
  return { required, observed, missing, complete: missing.length === 0 };
}
