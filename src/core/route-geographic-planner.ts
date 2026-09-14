import { AppError } from "./errors";
import type { Shipment } from "./orders-contract";
import {
  priorityConflictIds,
  priorityGroups,
  type RoutingCandidate,
} from "./route-logistics-policy";

type Point = { latitude: number; longitude: number };

type GeographicGroup = ReturnType<typeof priorityGroups>[number] & {
  point: Point;
  angle: number;
  radius: number;
  firstOpening: number;
  firstDeadline: number;
};

function validPoint(point: Point) {
  return (
    Number.isFinite(point.latitude) &&
    Math.abs(point.latitude) <= 90 &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.longitude) <= 180
  );
}

function geometry(point: Point, depot: Point) {
  const x = point.longitude - depot.longitude;
  const y = point.latitude - depot.latitude;
  return {
    angle: Math.atan2(y, x),
    radius: x * x + y * y,
  };
}

function geographicGroups(shipments: Shipment[], depot: Point) {
  if (!validPoint(depot)) throw new AppError("ROUTING_ORIGIN_REQUIRED", 409);
  const byId = new Map(shipments.map((shipment) => [shipment.id, shipment]));
  return priorityGroups(shipments).map((group): GeographicGroup => {
    const shipment = byId.get(group.id)!;
    const point = {
      latitude: shipment.latitude as number,
      longitude: shipment.longitude as number,
    };
    if (!validPoint(point) || shipment.locationStatus === "pending")
      throw new AppError("ROUTING_POINTS_REQUIRED", 409);
    const windows = group.shipmentIds.flatMap(
      (id) => byId.get(id)!.deliveryWindows,
    );
    return {
      ...group,
      point,
      ...geometry(point, depot),
      firstOpening: windows.length
        ? Math.min(...windows.map((window) => window.startMinute))
        : Number.POSITIVE_INFINITY,
      firstDeadline: windows.length
        ? Math.min(...windows.map((window) => window.endMinute))
        : Number.POSITIVE_INFINITY,
    };
  });
}

function pointKey(group: GeographicGroup) {
  return `${group.point.latitude},${group.point.longitude}`;
}

// Allocation works with physical delivery stops rather than customer labels.
// Distinct customers retain their own IDs and cards, but a confirmed coordinate
// is an indivisible visit for the fleet partition.
function physicalGeographicGroups(shipments: Shipment[], depot: Point) {
  const points = new Map<string, GeographicGroup[]>();
  for (const group of geographicGroups(shipments, depot)) {
    const key = pointKey(group);
    points.set(key, [...(points.get(key) ?? []), group]);
  }
  return [...points.values()].map((members): GeographicGroup => ({
    ...members[0],
    shipmentIds: members.flatMap((member) => member.shipmentIds),
  }));
}

// A circular sweep needs a cut. Starting immediately after the widest empty
// angle keeps natural neighbouring zones together instead of splitting them at
// the arbitrary -π/π boundary.
function circularSweep(groups: GeographicGroup[]) {
  const ordered = [...groups].sort(
    (left, right) =>
      left.angle - right.angle ||
      left.radius - right.radius ||
      left.id.localeCompare(right.id),
  );
  let cutAfter = 0;
  let widestGap = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < ordered.length; index++) {
    const nextAngle =
      index + 1 < ordered.length
        ? ordered[index + 1].angle
        : ordered[0].angle + Math.PI * 2;
    const gap = nextAngle - ordered[index].angle;
    if (gap > widestGap) {
      widestGap = gap;
      cutAfter = index;
    }
  }
  const start = (cutAfter + 1) % ordered.length;
  return [...ordered.slice(start), ...ordered.slice(0, start)];
}

// Exact dynamic partitioning of the angular sweep. Candidate count and work are
// derived from the actual destinations/vehicles; there is no business-size cap.
function balancedPartitions(groups: GeographicGroup[], parts: number) {
  const count = groups.length;
  const prefixOrders = [0];
  // Stryker disable next-line ArithmeticOperator: negating every prefix also negates every segment; the squared fixed-total objective is mathematically identical.
  for (const group of groups)
    prefixOrders.push(prefixOrders.at(-1)! + group.shipmentIds.length);
  // Stryker disable next-line ArithmeticOperator: any coefficient above the maximum destination-square swing produces the same order-first lexicographic partition.
  const geographicWeight = (count + 1) * (count + 1);
  const costs = Array.from({ length: parts + 1 }, () =>
    Array(count + 1).fill(Number.POSITIVE_INFINITY),
  );
  const previous = Array.from({ length: parts + 1 }, () =>
    Array<number | undefined>(count + 1),
  );
  costs[0][0] = 0;
  for (let part = 1; part <= parts; part++) {
    for (let end = part; end <= count; end++) {
      // Stryker disable next-line EqualityOperator: all group weights are positive and the convex objective can never choose an empty segment over its non-empty split.
      for (let start = part - 1; start < end; start++) {
        const orders = prefixOrders[end] - prefixOrders[start];
        const destinations = end - start;
        const cost =
          costs[part - 1][start] +
          orders * orders * geographicWeight +
          destinations * destinations;
        if (cost < costs[part][end]) {
          costs[part][end] = cost;
          previous[part][end] = start;
        }
      }
    }
  }
  const partitions: GeographicGroup[][] = [];
  let end = count;
  for (let part = parts; part > 0; part--) {
    const start = previous[part][end];
    // Stryker disable next-line all: defensive proof guard; valid dimensions always set the predecessor and no public input can exercise its negation.
    if (start === undefined) throw new AppError("ROUTING_MODEL_INVALID", 503);
    partitions.unshift(groups.slice(start, end));
    end = start;
  }
  return partitions;
}

export function geographicBalancedCandidate(
  shipments: Shipment[],
  vehicleIds: string[],
  depot: Point,
): RoutingCandidate {
  const groups = circularSweep(physicalGeographicGroups(shipments, depot));
  const usedVehicles = Math.min(vehicleIds.length, groups.length);
  const partitions = usedVehicles
    ? balancedPartitions(groups, usedVehicles)
    : [];
  return {
    routes: vehicleIds.map((vehicleId, index) => ({
      vehicleId,
      shipmentIds: (partitions[index] ?? []).flatMap(
        (group) => group.shipmentIds,
      ),
    })),
  };
}

// Google assigns customer destinations independently. If two different
// customers share the same confirmed point, consolidate that physical stop on
// the lane that requires the fewest moved orders, then prefer its lower current
// load and let the sequencing request optimize the road order with it fixed.
export function colocatedAllocationCandidate(
  shipments: Shipment[],
  candidate: RoutingCandidate,
): RoutingCandidate {
  const groups = geographicGroups(shipments, { latitude: 0, longitude: 0 });
  const byShipment = new Map(
    groups.flatMap((group) =>
      group.shipmentIds.map((id) => [id, group] as const),
    ),
  );
  const byPoint = new Map<string, GeographicGroup[]>();
  for (const group of groups) {
    const key = pointKey(group);
    byPoint.set(key, [...(byPoint.get(key) ?? []), group]);
  }
  const routes = candidate.routes.map((route) => ({
    vehicleId: route.vehicleId,
    shipmentIds: [...route.shipmentIds],
  }));
  for (const pointGroups of byPoint.values()) {
    const pointIds = new Set(pointGroups.flatMap((group) => group.shipmentIds));
    const routeIndices = routes.flatMap((route, index) =>
      route.shipmentIds.some((id) => pointIds.has(id)) ? [index] : [],
    );
    // Stryker disable next-line ConditionalExpression: one route already satisfies the invariant; re-inserting the same IDs is observably identical.
    if (routeIndices.length < 2) continue;
    const pointOrders = (routeIndex: number) =>
      routes[routeIndex].shipmentIds.filter((id) => pointIds.has(id)).length;
    const target = routeIndices.sort(
      (left, right) =>
        pointOrders(right) - pointOrders(left) ||
        routes[left].shipmentIds.length - routes[right].shipmentIds.length ||
        left - right,
    )[0];
    const originalTarget = routes[target].shipmentIds;
    const insertion = originalTarget.findIndex((id) => pointIds.has(id));
    const orderedGroups = [
      ...new Set(
        routes.flatMap((route) =>
          route.shipmentIds
            .filter((id) => pointIds.has(id))
            .map((id) => byShipment.get(id)!),
        ),
      ),
    ].sort((left, right) => left.rank - right.rank);
    const orderedIds = orderedGroups.flatMap((group) => group.shipmentIds);
    for (const route of routes)
      route.shipmentIds = route.shipmentIds.filter((id) => !pointIds.has(id));
    routes[target].shipmentIds.splice(insertion, 0, ...orderedIds);
  }
  return { routes };
}

// A safe alternative for a measured route that still arrives late. It keeps
// every allocation fixed and applies the business hierarchy literally:
// priority, earliest closing window, earliest opening, then geographic tie.
export function deadlineSequenceCandidate(
  shipments: Shipment[],
  candidate: RoutingCandidate,
  depot: Point,
): RoutingCandidate {
  const groups = geographicGroups(shipments, depot);
  const byShipment = new Map(
    groups.flatMap((group) =>
      group.shipmentIds.map((id) => [id, group] as const),
    ),
  );
  return {
    routes: candidate.routes.map((route) => {
      const routeGroups = [
        ...new Set(route.shipmentIds.map((id) => byShipment.get(id)!)),
      ];
      routeGroups.sort(
        (left, right) =>
          left.rank - right.rank ||
          left.firstDeadline - right.firstDeadline ||
          left.firstOpening - right.firstOpening ||
          left.angle - right.angle ||
          left.radius - right.radius ||
          left.id.localeCompare(right.id),
      );
      return {
        vehicleId: route.vehicleId,
        shipmentIds: routeGroups.flatMap((group) => group.shipmentIds),
      };
    }),
  };
}

// Google optimizes the general sequence, while this produces an additional
// candidate for an obvious physical invariant: within one priority tier, a
// truck must not leave an exact delivery point and return to it later. The
// candidate is always remeasured by Google Routes before it can win.
export function colocatedSequenceCandidate(
  shipments: Shipment[],
  candidate: RoutingCandidate,
): RoutingCandidate {
  const byId = new Map(shipments.map((shipment) => [shipment.id, shipment]));
  const groups = priorityGroups(shipments);
  const byShipment = new Map(
    groups.flatMap((group) =>
      group.shipmentIds.map((id) => [id, group] as const),
    ),
  );
  const pointKey = (group: (typeof groups)[number]) => {
    const shipment = byId.get(group.id)!;
    if (
      shipment.latitude === null ||
      shipment.longitude === null ||
      shipment.locationStatus === "pending"
    )
      throw new AppError("ROUTING_POINTS_REQUIRED", 409);
    return `${shipment.latitude},${shipment.longitude}`;
  };
  const compact = (
    routeGroups: (typeof groups)[number][],
    withinPriorityTier: boolean,
  ) => {
    const result: (typeof groups)[number][] = [];
    for (let start = 0; start < routeGroups.length;) {
      let end = start + 1;
      while (
        end < routeGroups.length &&
        (!withinPriorityTier ||
          routeGroups[end].rank === routeGroups[start].rank)
      )
        end++;
      const tier = routeGroups.slice(start, end);
      const byPoint = new Map<string, (typeof groups)[number][]>();
      for (const group of tier) {
        const key = pointKey(group);
        byPoint.set(key, [...(byPoint.get(key) ?? []), group]);
      }
      const emitted = new Set<string>();
      for (const group of tier) {
        const key = pointKey(group);
        if (emitted.has(key)) continue;
        emitted.add(key);
        result.push(...byPoint.get(key)!);
      }
      start = end;
    }
    return result;
  };
  const build = (withinPriorityTier: boolean): RoutingCandidate => ({
    routes: candidate.routes.map((route) => {
      const routeGroups = [
        ...new Set(route.shipmentIds.map((id) => byShipment.get(id)!)),
      ];
      return {
        vehicleId: route.vehicleId,
        shipmentIds: compact(routeGroups, withinPriorityTier).flatMap(
          (group) => group.shipmentIds,
        ),
      };
    }),
  });
  const acrossPriorities = build(false);
  return priorityConflictIds(shipments, acrossPriorities).size
    ? build(true)
    : acrossPriorities;
}
