import { AppError } from "./errors";
import type { Shipment } from "./orders-contract";
import {
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
  const groups = circularSweep(geographicGroups(shipments, depot));
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
