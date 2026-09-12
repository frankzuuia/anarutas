import { AppError } from "./errors";
import { stockMoveCapabilities } from "./odoo-capabilities";
import { uuid } from "./orders-validation";
import type {
  CandidateSelection,
  RoutingShipment,
} from "./order-candidates-contract";

export function fulfillmentStatus(state: unknown) {
  if (state === "done") return "validated" as const;
  if (state === "confirmed" || state === "assigned")
    return "pending_validation" as const;
  throw new AppError("CANDIDATE_CHANGED", 409);
}
export function routingCapabilities(
  picking: unknown,
  move: unknown,
  sale: unknown,
) {
  type Metadata = Record<
    string,
    { type?: string; relation?: string; selection?: [string, string][] }
  >;
  const p = picking as Metadata,
    m = move as Metadata,
    s = sale as Metadata;
  const required = (value: Metadata, field: string, type: string) => {
    if (value?.[field]?.type !== type)
      throw new AppError("ODOO_SCHEMA_UNSUPPORTED", 502);
  };
  for (const f of ["date_done", "scheduled_date", "write_date"])
    required(p, f, "datetime");
  required(m, "product_uom_qty", "float");
  if (
    m?.sale_line_id?.relation !== "sale.order.line" ||
    m?.origin_returned_move_id?.relation !== "stock.move"
  )
    throw new AppError("ODOO_SCHEMA_UNSUPPORTED", 502);
  const states = p?.state?.selection?.map(([key]) => key) || [];
  if (!["done", "confirmed", "assigned"].every((v) => states.includes(v)))
    throw new AppError("ODOO_SCHEMA_UNSUPPORTED", 502);
  const saleStates = (s?.state?.selection || [])
    .map(([key]) => key)
    .filter((key) => key === "sale" || key === "done");
  if (!saleStates.includes("sale"))
    throw new AppError("ODOO_SCHEMA_UNSUPPORTED", 502);
  return {
    ...stockMoveCapabilities(move),
    demandField: "product_uom_qty",
    saleStates,
    returnField: p.return_id?.relation === "stock.picking" ? "return_id" : null,
  };
}
export function routingDateEligible(
  shipment: RoutingShipment,
  range: { start: string; end: string },
) {
  const date =
    shipment.fulfillmentStatus === "validated"
      ? shipment.validatedAt
      : shipment.scheduledAt;
  if (!date) return false;
  const millis = Date.parse(date);
  return (
    Number.isFinite(millis) &&
    millis >= Date.parse(range.start.replace(" ", "T") + "Z") &&
    millis < Date.parse(range.end.replace(" ", "T") + "Z")
  );
}
export function parseSelection(value: unknown): CandidateSelection {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("INVALID_INPUT");
  const data = value as Record<string, unknown>;
  if (
    (data.mode !== "explicit" && data.mode !== "all_except") ||
    !Array.isArray(data.ids)
  )
    throw new AppError("INVALID_INPUT");
  const ids = data.ids.map(uuid).sort();
  if (new Set(ids).size !== ids.length) throw new AppError("INVALID_INPUT");
  return { mode: data.mode, ids };
}
export function resolveSelection<T extends { candidateId: string }>(
  candidates: T[],
  selection: CandidateSelection,
): T[] {
  const allowed = new Set(candidates.map((c) => c.candidateId));
  if (selection.ids.some((id) => !allowed.has(id)))
    throw new AppError("CANDIDATE_INVALID", 409);
  const ids = new Set(selection.ids);
  const chosen = candidates.filter((c) =>
    selection.mode === "explicit"
      ? ids.has(c.candidateId)
      : !ids.has(c.candidateId),
  );
  if (!chosen.length) throw new AppError("SELECTION_EMPTY", 422);
  return chosen;
}
export function lifecycleUpdate(
  previous: RoutingShipment,
  next: RoutingShipment,
): RoutingShipment {
  if (
    previous.pickingId !== next.pickingId ||
    previous.orderId !== next.orderId ||
    previous.partnerId !== next.partnerId
  )
    throw new AppError("CANDIDATE_CHANGED", 409);
  if (
    (previous.fulfillmentStatus ?? "validated") === "validated" &&
    next.fulfillmentStatus !== "validated"
  )
    throw new AppError("CANDIDATE_CHANGED", 409);
  return {
    ...previous,
    odooPickingState: next.odooPickingState,
    fulfillmentStatus: next.fulfillmentStatus,
    validatedAt: next.validatedAt,
    scheduledAt: next.scheduledAt,
    sourceUpdatedAt: next.sourceUpdatedAt,
    promisedAt: next.promisedAt,
    backorderId: next.backorderId,
    lines: next.lines,
  };
}
