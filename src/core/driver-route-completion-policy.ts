import { AppError } from "./errors";
import { gpsSample } from "./driver-execution-policy";
import { integer, uuid } from "./orders-validation";

export function routeCompletionInput(raw: Record<string, unknown>) {
  if (raw.confirmed !== true) throw new AppError("ROUTE_COMPLETION_CONFIRMATION_REQUIRED");
  return {
    commandId: uuid(raw.commandId), executionId: uuid(raw.executionId),
    publicationRevision: integer(raw.publicationRevision, 1), executionRevision: integer(raw.executionRevision, 1),
    depotVersion: integer(raw.depotVersion, 1), policyVersion: integer(raw.policyVersion, 1), sample: gpsSample(raw.sample),
  };
}

export function assertCompletionOrders(expected: string[], orders: { shipment_id: string; status: string }[]) {
  // Exact cardinality + unique actual IDs + membership prove a bijection (also reject duplicate expected IDs).
  if (!expected.length || orders.length !== expected.length ||
      new Set(orders.map(order => order.shipment_id)).size !== expected.length ||
      orders.some(order => !expected.includes(order.shipment_id) || !["delivered", "rescheduled"].includes(order.status)))
    throw new AppError("ROUTE_HAS_PENDING_ORDERS", 409);
}
