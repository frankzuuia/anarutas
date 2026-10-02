import { AppError } from "./errors";
import type { RoutingCandidate } from "./route-logistics-policy";

type Point = { latitude: number; longitude: number };
type ZoneGroup = Point & { shipmentIds: string[] };
type Vector = number[];
function vector(point: Point): Vector {
  if (
    !Number.isFinite(point.latitude) ||
    Math.abs(point.latitude) > 90 ||
    !Number.isFinite(point.longitude) ||
    Math.abs(point.longitude) > 180
  )
    throw new AppError("ROUTING_POINTS_REQUIRED", 409);
  const lat = (point.latitude * Math.PI) / 180,
    lng = (point.longitude * Math.PI) / 180;
  return [
    Math.cos(lat) * Math.cos(lng),
    Math.cos(lat) * Math.sin(lng),
    Math.sin(lat),
  ];
}
function distance(a: Vector, b: Vector) {
  return a.reduce(
    (sum, coordinate, index) => sum + (coordinate - b[index]) ** 2,
    0,
  );
}

export function repairEmptyZones(
  assignments: number[],
  vectors: Vector[],
  centers: Vector[],
) {
  const count = centers.length;
  const sizes = centers.map(
    (_, index) => assignments.filter((zone) => zone === index).length,
  );
  // An empty centroid is reseeded from a non-singleton zone; no order is lost.
  for (let zone = 0; zone < count; zone++) {
    if (sizes[zone]) continue;
    const candidates = vectors
      .map((_, index) => index)
      .filter((index) => sizes[assignments[index]] > 1);
    const farthest = candidates.reduce((best, index) =>
      distance(vectors[index], centers[assignments[index]]) >
      distance(vectors[best], centers[assignments[best]])
        ? index
        : best,
    );
    sizes[assignments[farthest]]--;
    assignments[farthest] = zone;
    sizes[zone]++;
  }
  return sizes;
}

// Geographical ownership is independent of order counts, priority and input
// ordering. Nearby destinations cannot be exported to a remote zone merely to
// equalize the number of orders. Google still determines roads and visit times.
export function geographicZones(
  groups: ZoneGroup[],
  vehicleIds: string[],
  depot: Point,
): RoutingCandidate {
  if (!vehicleIds.length) throw new AppError("ROUTING_VEHICLES_REQUIRED", 409);
  const physical = new Map<string, ZoneGroup>();
  for (const group of groups) {
    vector(group);
    const key = JSON.stringify([group.latitude, group.longitude]);
    const existing = physical.get(key);
    if (existing) existing.shipmentIds.push(...group.shipmentIds);
    else physical.set(key, { ...group, shipmentIds: [...group.shipmentIds] });
  }
  const points = [...physical.values()].sort(
    (a, b) => a.latitude - b.latitude || a.longitude - b.longitude,
  );
  const vectors = points.map(vector),
    origin = vector(depot);
  const count = Math.min(points.length, vehicleIds.length);
  const centers: Vector[] = [];
  while (centers.length < count) {
    const candidates = vectors.filter((point) => !centers.includes(point));
    const separation = (point: Vector) =>
      centers.length
        ? Math.min(...centers.map((center) => distance(point, center)))
        : distance(point, origin);
    centers.push(
      candidates.reduce((best, point) =>
        separation(point) > separation(best) ? point : best,
      ),
    );
  }
  let assignments: number[] = [];
  const seen = new Set<string>();
  while (count) {
    assignments = vectors.map((point) =>
      centers.reduce(
        (best, center, index) =>
          distance(point, center) < distance(point, centers[best])
            ? index
            : best,
        0,
      ),
    );
    const sizes = repairEmptyZones(assignments, vectors, centers);
    const signature = assignments.join(",");
    if (seen.has(signature)) break;
    seen.add(signature);
    for (let zone = 0; zone < count; zone++) {
      centers[zone] = [0, 1, 2].map(
        (axis) =>
          vectors.reduce(
            (sum, point, index) =>
              sum + (assignments[index] === zone ? point[axis] : 0),
            0,
          ) / sizes[zone],
      );
    }
  }
  const stableVehicles = [...vehicleIds].sort();
  return {
    routes: stableVehicles.map((vehicleId, zone) => ({
      vehicleId,
      shipmentIds: points.flatMap((point, index) =>
        assignments[index] === zone ? point.shipmentIds : [],
      ),
    })),
  };
}

export function zoneVehicleIndices(
  candidate: RoutingCandidate,
  vehicleIds: string[],
) {
  return new Map(
    candidate.routes.flatMap((route) =>
      route.shipmentIds.map(
        (id) => [id, vehicleIds.indexOf(route.vehicleId)] as const,
      ),
    ),
  );
}
