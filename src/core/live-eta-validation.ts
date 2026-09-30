import { AppError } from "./errors";
import { uuid } from "./orders-validation";
import { trackingPolicy } from "./live-tracking-contract";
import type { LiveEta } from "./live-eta";
import type { WarehouseTrackingDestination } from "./live-warehouse-policy";

export function trackingEta(raw: unknown, target: string | null, now: Date, destination: WarehouseTrackingDestination | null = null): LiveEta | null {
  if (raw == null) return null; // Older APKs do not send this field.
  if (typeof raw !== "object" || Array.isArray(raw)) throw new AppError("INVALID_TRACKING_ETA");
  const r = raw as Record<string, unknown>;
  const targetStopId = destination ? null : uuid(r.targetStopId);
  if (destination ? target !== null || r.targetStopId !== null || r.depotVersion !== destination.depotVersion : targetStopId !== target)
    throw new AppError("INVALID_TRACKING_ETA");
  const state = r.state;
  if (state !== "ready" && state !== "calculating" && state !== "unavailable") throw new AppError("INVALID_TRACKING_ETA");
  const seconds = r.remainingSeconds;
  if (state === "ready" ? !Number.isInteger(seconds) || (seconds as number) < 0 || (seconds as number) > 2147483647 : seconds !== null)
    throw new AppError("INVALID_TRACKING_ETA");
  const age = r.ageMilliseconds;
  if (!Number.isFinite(age) || (age as number) < 0 || (age as number) > trackingPolicy.maxSampleAgeMs)
    throw new AppError("INVALID_TRACKING_ETA");
  return { targetStopId, ...(destination ? { depotVersion: destination.depotVersion } : {}),
    state, remainingSeconds: seconds as number | null, observedAt: new Date(now.getTime() - (age as number)).toISOString() };
}
