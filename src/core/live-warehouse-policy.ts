import { AppError } from "./errors";
import { assertCompletionOrders } from "./driver-route-completion-policy";
import type { RoutingSettings } from "./routing-contract";

export type WarehouseTrackingDestination = { kind: "warehouse"; depotVersion: number };
export type LiveWarehouseDestination = WarehouseTrackingDestination & {
  address: string; latitude: number; longitude: number; observedAt: string;
};

export function trackingWarehouseDestination(raw: unknown, target: string | null): WarehouseTrackingDestination | null {
  if (raw == null) return null; // Existing APKs have no auxiliary destination.
  if (typeof raw !== "object" || Array.isArray(raw)) throw new AppError("INVALID_TRACKING_DESTINATION");
  const value = raw as Record<string, unknown>;
  if (target !== null || value.kind !== "warehouse" || !Number.isInteger(value.depotVersion) ||
      (value.depotVersion as number) < 1 || (value.depotVersion as number) > 2147483647)
    throw new AppError("INVALID_TRACKING_DESTINATION");
  return { kind: "warehouse", depotVersion: value.depotVersion as number };
}

// Re-check latest business state at read time; a previously valid guide can be retired.
export function liveWarehouseDestination(stored: { version: number | null; target: string | null;
  stopped: boolean; completed: boolean; receivedAt: Date | null }, settings: RoutingSettings,
  expected: string[], orders: { shipment_id: string; status: string }[]): LiveWarehouseDestination | null {
  if (stored.version === null || stored.target !== null || stored.stopped || stored.completed ||
      !stored.receivedAt || !settings.depotLocation || settings.version !== stored.version) return null;
  try { assertCompletionOrders(expected, orders); }
  catch (error) {
    // assertCompletionOrders has exactly one domain error: a non-terminal/invalid publication.
    if (error instanceof AppError) return null;
    throw error;
  }
  return { kind: "warehouse", depotVersion: stored.version, address: settings.depotAddress,
    latitude: settings.depotLocation.latitude, longitude: settings.depotLocation.longitude,
    observedAt: stored.receivedAt.toISOString() };
}
