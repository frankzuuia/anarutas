import type { OrderBoard } from "./orders-contract";
import type { RoutingSettings } from "./routing-contract";

export type ManualPreviewStatus = {
  version: number;
  current: boolean;
  status: "pending" | "running" | "failed" | null;
  errorCode: string | null;
};

export type ManualPreviewDecision =
  "current" | "waiting" | "failed" | "incomplete" | "stale" | "request";

/** The backend remains authoritative and deduplicates concurrent requests. */
export function manualPreviewDecision(
  board: OrderBoard,
  settings: RoutingSettings,
  status: ManualPreviewStatus,
): ManualPreviewDecision {
  if (status.version !== board.plan.version) return "stale";
  if (status.current) return "current";
  if (status.status === "pending" || status.status === "running")
    return "waiting";
  if (status.status === "failed") return "failed";
  const assigned = board.shipments.filter(
    (shipment) =>
      shipment.vehicle_id &&
      shipment.fulfillmentMode === "delivery" &&
      !shipment.customerArchived,
  );
  if (
    !settings.depotLocation ||
    board.plan.departure_minute == null ||
    assigned.length === 0 ||
    assigned.some(
      (shipment) =>
        shipment.latitude == null ||
        shipment.longitude == null ||
        shipment.locationStatus === "pending",
    )
  )
    return "incomplete";
  return "request";
}
