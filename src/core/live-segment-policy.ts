import { AppError } from "./errors";
import type { LiveRoute, LiveStop } from "./live-routes";
import { trackingPolicy } from "./live-tracking-contract";

export type SegmentSelection = {
  executionId: string; fromStopId: string; toStopId: string; fromCurrent: boolean;
};
export type SegmentPoint = { latitude: number; longitude: number };
export type SegmentPlan = {
  contextKey: string; points: SegmentPoint[]; fromPosition: number; toPosition: number;
  positions: number[]; fromCurrent: boolean; serviceSeconds: number;
  unknownServiceStops: number; omittedRetries: number;
};
export type SegmentEstimate = Omit<SegmentPlan, "points"> & {
  executionId: string; travelSeconds: number; totalSeconds: number;
  calculatedAt: string; expiresAt: string;
};

export function activeSegmentStop(route: LiveRoute) {
  return route.targetStopId ?? route.arrivedStopId;
}

export function segmentContextKey(route: LiveRoute, selection: SegmentSelection) {
  return JSON.stringify([selection, route.completedAt ?? null,
    selection.fromCurrent ? [route.targetStopId, route.arrivedStopId] : null,
    route.stops.map(s => [s.id, s.position, s.latitude, s.longitude, s.arrivedAt,
      s.unloadingMinutes ?? null, s.orders.map(o => [o.id, o.status])])]);
}

export function segmentGpsFresh(route: LiveRoute, now: number) {
  const location = route.location;
  const age = location ? now - Date.parse(location.observedAt) : Infinity;
  return !!location && !location.stopped && Number.isFinite(age) && age >= 0 &&
    age <= trackingPolicy.freshSeconds * 1000;
}

function point(stop: Pick<LiveStop, "latitude" | "longitude">): SegmentPoint {
  const { latitude, longitude } = stop;
  if (latitude === null || longitude === null || !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    throw new AppError("SEGMENT_POINTS_REQUIRED", 409);
  return { latitude, longitude };
}

export function buildSegmentPlan(route: LiveRoute, selection: SegmentSelection, now: number): SegmentPlan {
  if (route.id !== selection.executionId || route.completedAt || !Number.isFinite(now))
    throw new AppError("SEGMENT_ROUTE_CHANGED", 409);
  // Resolve all identities inside this execution, including a live selection's original anchor.
  if (!route.stops.some(s => s.id === selection.fromStopId)) throw new AppError("SEGMENT_STOP_INVALID", 409);
  const from = route.stops.find(s => s.id === (selection.fromCurrent ? activeSegmentStop(route) : selection.fromStopId));
  const to = route.stops.find(s => s.id === selection.toStopId);
  if (!from || !to || from.position > to.position || (!selection.fromCurrent && from.id === to.id) || !to.orders.some(o => o.status === "open"))
    throw new AppError("SEGMENT_STOP_INVALID", 409);
  if (selection.fromCurrent && !segmentGpsFresh(route, now))
    throw new AppError("SEGMENT_GPS_STALE", 409);
  const between = route.stops.filter(s => s.position > from.position && s.position < to.position);
  const pending = between.filter(s => s.orders.some(o => o.status === "open"));
  const stops = from.id === to.id ? [to] : [from, ...pending.sort((a,b) => a.position-b.position), to];
  const atOrigin = selection.fromCurrent && route.arrivedStopId === from.id;
  const points = (selection.fromCurrent && !atOrigin ? [point(route.location!), ...stops.map(point)] : stops.map(point))
    .filter((p,i,all) => i === 0 || p.latitude !== all[i-1].latitude || p.longitude !== all[i-1].longitude);
  let serviceSeconds = 0, unknownServiceStops = 0;
  for (const stop of stops.slice(selection.fromCurrent ? 0 : 1, -1)) {
    if (stop.unloadingMinutes == null) { unknownServiceStops++; continue; }
    if (!Number.isSafeInteger(stop.unloadingMinutes) || stop.unloadingMinutes < 0)
      throw new AppError("SEGMENT_SERVICE_INVALID", 409);
    let seconds = stop.unloadingMinutes * 60;
    if (atOrigin && stop.id === from.id) {
      const elapsed = now - Date.parse(stop.arrivedAt ?? "");
      if (!Number.isFinite(elapsed) || elapsed < 0) throw new AppError("SEGMENT_ROUTE_CHANGED", 409);
      seconds = Math.max(0, seconds - Math.floor(elapsed / 1000));
    }
    serviceSeconds += seconds;
  }
  return { contextKey: segmentContextKey(route, selection), points,
    fromPosition: from.position, toPosition: to.position, positions: stops.map(s => s.position),
    fromCurrent: selection.fromCurrent, serviceSeconds, unknownServiceStops,
    omittedRetries: between.filter(s => !s.orders.some(o => o.status === "open") && s.progress.pending > 0).length };
}

export function toggleSegmentStop(route: LiveRoute, previous: SegmentSelection | null, stopId: string): SegmentSelection | null {
  const stop = route.stops.find(s => s.id === stopId);
  if (!stop || !stop.orders.some(o => o.status === "open")) return previous;
  if (previous?.executionId === route.id && (previous.fromCurrent ? activeSegmentStop(route) : previous.fromStopId) === stopId) return null;
  if (previous?.executionId === route.id && previous.toStopId === stopId) return { ...previous, toStopId: "" };
  const first = previous?.executionId === route.id && !previous.toStopId
    ? route.stops.find(s => s.id === (previous.fromCurrent ? activeSegmentStop(route) : previous.fromStopId)) : null;
  const endpoints = first ? [first,stop].sort((a,b) => a.position-b.position) : [stop];
  return { executionId: route.id, fromStopId: endpoints[0].id, toStopId: endpoints[1]?.id ?? "",
    fromCurrent: endpoints[0].id === activeSegmentStop(route) };
}

export function segmentMinutes(seconds: number) {
  return seconds === 0 ? "0 min" : seconds < 60 ? "<1 min" : `≈${Math.ceil(seconds / 60)} min`;
}
