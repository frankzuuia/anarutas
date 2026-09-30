import { createHash } from "node:crypto";
import { AppError } from "./errors";
import type {
  FinancialMove,
  FinancialObservation,
  FinancialReason,
  FinancialSaleLine,
  FinancialSnapshot,
  FinancialTarget,
} from "./financial-contract";
import {
  FinancialDecimal as D,
  roundFinancial,
  sumFinancial,
} from "./financial-values";

/** Canonical JSON also makes Postgres jsonb key reordering harmless. Arrays retain meaning. */
export function financialHash(value: unknown): string {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    return item;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function assertFinancialCoherence(before: unknown, after: unknown) {
  if (financialHash(before) !== financialHash(after))
    throw new AppError("ODOO_FINANCIAL_CHANGED_DURING_READ", 409);
}
function reconcileAmounts(observation: FinancialObservation): string | null {
  const { saleLines, order, currency } = observation;
  const lines = saleLines.filter((line) => !line.displayType);
  const step = currency.rounding;
  for (const amounts of [order.amounts, ...lines.map((line) => line.amounts)]) {
    if (
      !roundFinancial(new D(amounts.untaxed).plus(amounts.tax), step).eq(
        amounts.total,
      )
    )
      return null;
  }
  const totals = sumFinancial(lines.map((line) => line.amounts.total));
  const subtotals = sumFinancial(lines.map((line) => line.amounts.untaxed));
  const taxes = sumFinancial(lines.map((line) => line.amounts.tax));
  if (
    totals.eq(order.amounts.total) &&
    subtotals.eq(order.amounts.untaxed) &&
    taxes.eq(order.amounts.tax)
  )
    return "0";
  // Demonstrate global vs per-line rounding only without taxes. Tax rules are Odoo's.
  if (
    lines.some(
      (line) => line.taxIds.length || !new D(line.amounts.tax).isZero(),
    ) ||
    !new D(order.amounts.tax).isZero()
  )
    return null;
  const exact = lines.map((line) =>
    new D(line.quantity)
      .mul(line.unitPrice)
      .mul(new D(100).minus(line.discount))
      .div(100),
  );
  if (
    exact.some(
      (value, index) =>
        !roundFinancial(value, step).eq(lines[index].amounts.total),
    )
  )
    return null;
  const global = roundFinancial(
    sumFinancial(exact.map((value) => value.toFixed())),
    step,
  );
  return global.eq(order.amounts.total) ? global.minus(totals).toFixed() : null;
}
function inspectRelatedMoves(
  observation: FinancialObservation,
  saleIds: Set<number>,
  reasons: Set<FinancialReason>,
) {
  const related = new Map(
    observation.relatedPickings.map((item) => [item.id, item]),
  );
  const moves = observation.moves.filter(
    (item) =>
      item.state !== "cancel" &&
      item.saleLineId !== null &&
      saleIds.has(item.saleLineId),
  );
  for (const move of moves) {
    if (move.returnedMoveId !== null) reasons.add("RETURNED_STOCK");
    const other =
      move.pickingId === null ? undefined : related.get(move.pickingId);
    if (
      other &&
      other.id !== observation.picking.id &&
      other.outgoing &&
      other.customerDestination &&
      new D(move.demand).gt(0)
    )
      reasons.add("SPLIT_DELIVERY");
  }
}
function deliveryLines(
  observation: FinancialObservation,
  saleIds: Set<number>,
  reasons: Set<FinancialReason>,
) {
  const { picking, moves, order } = observation;
  if (!["sale", "done"].includes(order.state))
    reasons.add("ORDER_NOT_CONFIRMED");
  if (!picking.outgoing || !picking.customerDestination)
    reasons.add("NOT_CUSTOMER_DELIVERY");
  const current = moves.filter(
    (move) => move.pickingId === picking.id && move.state !== "cancel",
  );
  if (current.some((move) => move.saleLineId === null))
    reasons.add("UNLINKED_MOVE");
  const lines = current.filter(
    (move): move is typeof move & { saleLineId: number } =>
      move.saleLineId !== null && saleIds.has(move.saleLineId),
  );
  if (!lines.length) reasons.add("NO_DELIVERY_LINES");
  if (picking.state === "done" && lines.some((move) => move.state !== "done"))
    reasons.add("MOVE_NOT_VALIDATED");
  inspectRelatedMoves(observation, saleIds, reasons);
  return lines;
}
function supportedSigns(line: FinancialSaleLine, quantities: string[]) {
  return (
    new D(line.quantity).gt(0) &&
    new D(line.unitPrice).gte(0) &&
    new D(line.discount).gte(0) &&
    new D(line.discount).lte(100) &&
    quantities.every((quantity) => new D(quantity).gte(0)) &&
    new D(line.amounts.total).gte(0)
  );
}
function inspectLineQuantity(
  line: FinancialSaleLine,
  linked: FinancialMove[],
  done: boolean,
  reasons: Set<FinancialReason>,
) {
  const quantities = linked.map((move) => (done ? move.quantity : move.demand));
  if (
    !sumFinancial(quantities).eq(line.quantity) ||
    (done && !new D(line.delivered).eq(line.quantity))
  )
    reasons.add("QUANTITY_MISMATCH");
  if (!supportedSigns(line, quantities)) reasons.add("UNSUPPORTED_SIGN");
}
function inspectLineIdentity(
  line: FinancialSaleLine,
  linked: FinancialMove[],
  currencyId: number,
  reasons: Set<FinancialReason>,
) {
  if (!linked.length) reasons.add("SALE_LINE_NOT_DELIVERED");
  if (linked.some((move) => move.uomId !== line.uomId))
    reasons.add("UOM_MISMATCH");
  if (linked.some((move) => move.productId !== line.productId))
    reasons.add("PRODUCT_MISMATCH");
  if (line.currencyId !== currencyId) reasons.add("CURRENCY_MISMATCH");
}
function financialStatus(
  observation: FinancialObservation,
  reasons: Set<FinancialReason>,
): FinancialSnapshot["status"] {
  const { picking, order } = observation;
  if (picking.state === "cancel" || order.state === "cancel")
    return "cancelled";
  if (reasons.size) return "needs_review";
  return picking.state === "done" && picking.validatedAt
    ? "ready"
    : "pending_validation";
}
export function buildFinancialSnapshot(
  target: FinancialTarget,
  observation: FinancialObservation,
): FinancialSnapshot {
  const { picking, order, currency, saleLines } = observation;
  if (
    picking.id !== target.pickingId ||
    order.id !== target.orderId ||
    picking.partnerId !== target.partnerId
  )
    throw new AppError("FINANCIAL_IDENTITY_CHANGED", 409);
  const reasons = new Set<FinancialReason>();
  const commercial = saleLines.filter((line) => !line.displayType);
  const lines = deliveryLines(
    observation,
    new Set(commercial.map((line) => line.id)),
    reasons,
  );
  for (const line of commercial) {
    const linked = lines.filter((move) => move.saleLineId === line.id);
    inspectLineIdentity(line, linked, currency.id, reasons);
    inspectLineQuantity(line, linked, picking.state === "done", reasons);
  }
  const adjustment = reconcileAmounts(observation);
  if (adjustment === null) reasons.add("AMOUNT_MISMATCH");
  const status = financialStatus(observation, reasons);
  return {
    contractVersion: 1,
    target,
    companyId: observation.companyId,
    status,
    reasons: [...reasons].sort(),
    currency,
    picking,
    order,
    saleLines,
    lines,
    shipmentAmounts: status === "ready" ? order.amounts : null,
    roundingAdjustment: adjustment,
    observation,
  };
}
