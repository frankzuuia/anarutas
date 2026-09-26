import { AppError } from "./errors";
import { integer, uuid } from "./orders-validation";
import type { DriverOrderStatus } from "./driver-service-policy";
import { controlScreenTypes, type ControlScreenType } from "./control-screens";
import { trackingPolicy, maxControlScreens, type ControlScreen } from "./live-tracking-contract";
export { trackingPolicy, maxControlScreens, type ControlScreen } from "./live-tracking-contract";

export function trackingSample(raw: unknown) {
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new AppError("INVALID_TRACKING_SAMPLE");
  const r = raw as Record<string, unknown>;
  const finite = (v: unknown, low: number, high: number) => {
    const number = v as number; // Number.isFinite rejects non-numbers without coercion.
    if (!Number.isFinite(number) || number < low || number > high) throw new AppError("INVALID_TRACKING_SAMPLE");
    return number;
  };
  if (r.mock !== false) throw new AppError("INVALID_TRACKING_SAMPLE");
  return { latitude: finite(r.latitude, -90, 90), longitude: finite(r.longitude, -180, 180),
    accuracy: finite(r.accuracyMeters, 0, Number.MAX_SAFE_INTEGER),
    age: finite(r.ageMilliseconds, 0, trackingPolicy.maxSampleAgeMs) };
}
export function stopProgress(statuses: DriverOrderStatus[]) {
  const delivered = statuses.filter(s => s === "delivered").length;
  const rescheduled = statuses.filter(s => s === "rescheduled").length;
  const pending = statuses.filter(s => s === "closed_pending" || s === "rejected").length;
  const finished = statuses.length > 0 && delivered + rescheduled === statuses.length;
  return { total: statuses.length, delivered, rescheduled, pending, remaining: statuses.length - delivered - rescheduled,
    visible: !finished, status: finished ? (rescheduled ? "rescheduled" : "delivered") : pending ? "incident" : "open" };
}
export function controlScreens(raw: unknown): ControlScreen[] {
  if (!Array.isArray(raw) || raw.length > maxControlScreens) throw new AppError("INVALID_CONTROL_LAYOUT");
  const screens = raw.map((value): ControlScreen => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("INVALID_CONTROL_LAYOUT");
    const r = value as Record<string, unknown>;
    const id = uuid(r.id);
    if (!controlScreenTypes.some(t => t.id === r.type)) throw new AppError("INVALID_CONTROL_LAYOUT");
    return { id, type: r.type as ControlScreenType, driverId: r.driverId === "" ? "" : uuid(r.driverId),
      vehicleId: r.vehicleId === "" ? "" : uuid(r.vehicleId) };
  });
  if (new Set(screens.map(s => s.id)).size !== screens.length) throw new AppError("INVALID_CONTROL_LAYOUT");
  return screens;
}
export function trackingIdentity(raw: Record<string, unknown>) {
  return { executionId: uuid(raw.executionId), sessionId: uuid(raw.sessionId),
    publicationRevision: integer(raw.publicationRevision, 1) };
}
