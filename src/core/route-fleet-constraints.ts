import { AppError } from "./errors";
import { priorityOrder } from "./route-logistics-policy";
import type {
  GoogleOptimizationRequest,
  GoogleOptimizationResult,
} from "./route-optimization-google";

type Group = { latitude: number; longitude: number; rank: number };
const pointKey = (point: Pick<Group, "latitude" | "longitude">) =>
  JSON.stringify([point.latitude, point.longitude]);
const priorityTag = (rank: number) => `priority:${priorityOrder[rank]}`;

// Google rejects a delay exceeding the global horizon (validation code 3009).
// Preserve each route's existing effective horizon as its duration limit, and
// pad only the global validation envelope enough to contain a forbidden delay.
// Even zero-service, co-located visits cannot fit that delay in a valid route.
export function strictPriorityTransitions(
  groups: Group[],
  model: GoogleOptimizationRequest["model"],
): NonNullable<GoogleOptimizationRequest["model"]["transitionAttributes"]> {
  const span =
    (Date.parse(model.globalEndTime) - Date.parse(model.globalStartTime)) /
    1000;
  if (!Number.isFinite(span) || span <= 0)
    throw new AppError("ROUTING_MODEL_INVALID", 503);
  const ranks = [...new Set(groups.map((group) => group.rank))].sort(
    (left, right) => left - right,
  );
  const limits = model.vehicles.map((vehicle) => {
    const configured = vehicle.routeDurationLimit?.maxDuration;
    const seconds =
      configured === undefined ? span : Number(configured.slice(0, -1));
    if (
      configured !== undefined &&
      (!configured.endsWith("s") || !Number.isFinite(seconds) || seconds < 0)
    )
      throw new AppError("ROUTING_MODEL_INVALID", 503);
    return Math.min(span, seconds);
  });
  const delay = Math.floor(Math.max(...limits)) + 1;
  if (ranks.length > 1) {
    model.vehicles.forEach((vehicle, index) => {
      vehicle.routeDurationLimit = { maxDuration: `${limits[index]}s` };
    });
    model.globalEndTime = new Date(
      Date.parse(model.globalStartTime) + Math.max(span, delay) * 1000,
    ).toISOString();
  }
  return ranks.flatMap((from) =>
    ranks
      .filter((to) => to < from)
      .map((to) => ({
        srcTag: priorityTag(from),
        dstTag: priorityTag(to),
        delay: `${delay}s`,
      })),
  );
}

// One uniquely required shipment anchors each mixed point. Every dependent
// visit must use that anchor's vehicle; no vehicle is selected in advance and
// there are no dependency cycles or precedence between different vehicles.
export function bindPhysicalPointOwners(
  groups: Group[],
  model: GoogleOptimizationRequest["model"],
) {
  const points = new Map<string, number[]>();
  groups.forEach((group, index) => {
    const key = pointKey(group);
    points.set(key, [...(points.get(key) ?? []), index]);
  });
  const requirements: NonNullable<
    GoogleOptimizationRequest["model"]["shipmentTypeRequirements"]
  > = [];
  for (const indices of points.values()) {
    if (indices.length < 2) continue;
    const anchor = indices[0];
    const required = `point-owner:${anchor}`;
    const dependent = `point-member:${anchor}`;
    model.shipments[anchor].shipmentType = required;
    for (const index of indices.slice(1))
      model.shipments[index].shipmentType = dependent;
    requirements.push({
      requiredShipmentTypeAlternatives: [required],
      dependentShipmentTypes: [dependent],
      requirementMode: "PERFORMED_BY_SAME_VEHICLE",
    });
  }
  if (requirements.length) model.shipmentTypeRequirements = requirements;
}

// Validate the business invariants independently of Google honoring the model.
// A complete but inverted or split-point receipt must not be silently sorted.
export function assertFleetBusinessConstraints(
  request: GoogleOptimizationRequest,
  result: GoogleOptimizationResult,
) {
  const owners = new Map<string, number>();
  for (const route of result.routes) {
    let previousRank = -1;
    for (const visit of route.visits) {
      const delivery =
        request.model.shipments[visit.shipmentIndex]?.deliveries[0];
      if (!delivery)
        throw new AppError("ROUTING_RESPONSE_INVALID", 503, {
          field: "route.shipment",
        });
      const rank = priorityOrder.findIndex((_, index) =>
        delivery.tags?.includes(priorityTag(index)),
      );
      if (rank < 0 || rank < previousRank)
        throw new AppError("ROUTING_RESPONSE_INVALID", 503, {
          field: "route.customerPriority",
        });
      previousRank = rank;
      const key = pointKey(delivery.arrivalLocation);
      const owner = owners.get(key);
      if (owner !== undefined && owner !== route.vehicleIndex)
        throw new AppError("ROUTING_RESPONSE_INVALID", 503, {
          field: "route.physicalPointOwner",
        });
      owners.set(key, route.vehicleIndex);
    }
  }
}
