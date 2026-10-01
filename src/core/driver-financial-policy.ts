import type { FinancialSnapshot } from "./financial-contract";
import type { ShipmentLine } from "./orders-contract";
import type {
  DriverFinancialLine,
  DriverFinancialView,
  FinancialIncidentRow,
  FinancialProjectionInput,
  FinancialPublishedLine,
} from "./driver-financial-contract";
import { FinancialDecimal as D, sumFinancial } from "./financial-values";
import { financialHash } from "./financial-policy";
import { allocateFinancialAmount } from "./financial-allocation";
import { AppError } from "./errors";
import { incidentFinancialDisplay } from "./incident-financial-display";

/** Ordered import is verified against the immutable publication before its IDs are used. */
export function financialLineIdentity(
  published: FinancialPublishedLine[],
  imported: ShipmentLine[],
  snapshot: FinancialSnapshot,
) {
  if (
    published.length !== imported.length ||
    imported.length !== snapshot.lines.length ||
    new Set(imported.map((line) => line.moveId)).size !== imported.length
  )
    return null;
  const moves = new Map(snapshot.lines.map((move) => [move.id, move]));
  if (moves.size !== snapshot.lines.length) return null;
  const identities = imported.map((line, index) => {
    const original = published[index],
      move = moves.get(line.moveId);
    if (
      original.name !== line.name ||
      original.quantity !== line.quantity ||
      original.unit !== line.unit ||
      !move ||
      move.productId !== line.productId ||
      (line.saleLineId !== undefined && move.saleLineId !== line.saleLineId) ||
      (line.uomId !== undefined && move.uomId !== line.uomId)
    )
      return null;
    return move;
  });
  return identities.every((move) => move !== null) ? identities : null;
}

export function financialIncidentBasis(
  snapshot: FinancialSnapshot,
  moveId: number,
) {
  const move = snapshot.lines.find((line) => line.id === moveId);
  const sale = snapshot.saleLines.find((line) => line.id === move?.saleLineId);
  if (!move || !sale) return null;
  return financialHash({
    target: snapshot.target,
    companyId: snapshot.companyId,
    currency: snapshot.currency,
    move: {
      id: move.id,
      productId: move.productId,
      uomId: move.uomId,
      quantity: move.quantity,
      saleLineId: move.saleLineId,
    },
    sale: {
      quantity: sale.quantity,
      unitPrice: sale.unitPrice,
      discount: sale.discount,
      amounts: sale.amounts,
      taxIds: sale.taxIds,
    },
    saleMoves: snapshot.lines
      .filter((line) => line.saleLineId === sale.id)
      .map((line) => ({
        id: line.id,
        quantity: line.quantity,
        productId: line.productId,
        uomId: line.uomId,
      }))
      .sort((a, b) => a.id - b.id),
    roundingAdjustment: snapshot.roundingAdjustment,
  });
}

function incidentWeights(
  incidents: FinancialIncidentRow[],
  lineIndex: number,
  snapshot: FinancialSnapshot,
  moveId: number,
  saleLineId: number,
  quantity: string,
  issues: Set<string>,
) {
  const selected = incidents.filter(
    (incident) =>
      incident.lineIndex === lineIndex && incident.status !== "canceled",
  );
  let deducted = new D(0),
    deferred = new D(0),
    physical = new D(quantity);
  const basis = financialIncidentBasis(snapshot, moveId);
  for (const incident of selected) {
    const count = new D(incident.quantity);
    physical = physical.minus(count);
    if (
      !incident.financialSnapshot ||
      incident.financialMoveId !== moveId ||
      incident.financialSaleLineId !== saleLineId ||
      !incident.financialRevision ||
      financialIncidentBasis(incident.financialSnapshot, moveId) !== basis
    )
      issues.add("INCIDENT_FINANCIAL_REVIEW_REQUIRED");
    if (
      incident.kind === "replacement_quality" ||
      incident.kind === "replacement_wrong_product"
    ) {
      if (incident.replacementPayment === "defer")
        deferred = deferred.plus(count);
      else if (incident.replacementPayment !== "pay_full")
        issues.add("REPLACEMENT_PAYMENT_REQUIRED");
    } else deducted = deducted.plus(count);
  }
  if (physical.lt(0)) issues.add("INCIDENT_QUANTITY_EXCEEDED");
  return {
    physical: D.max(physical, 0).toFixed(),
    weights: [
      D.max(new D(quantity).minus(deducted).minus(deferred), 0).toFixed(),
      deducted.toFixed(),
      deferred.toFixed(),
    ],
  };
}

function sourceLineAmounts(snapshot: FinancialSnapshot) {
  const amounts = new Map<
    number,
    { untaxed: string; tax: string; total: string }
  >();
  for (const sale of snapshot.saleLines.filter((line) => !line.displayType)) {
    const moves = snapshot.lines
      .filter((move) => move.saleLineId === sale.id)
      .sort((a, b) => a.id - b.id);
    const weights = moves.map((move) => move.quantity),
      step = snapshot.currency.rounding;
    const untaxed = allocateFinancialAmount(
      sale.amounts.untaxed,
      weights,
      step,
    );
    const tax = allocateFinancialAmount(sale.amounts.tax, weights, step);
    moves.forEach((move, index) =>
      amounts.set(move.id, {
        untaxed: untaxed[index],
        tax: tax[index],
        total: new D(untaxed[index]).plus(tax[index]).toFixed(),
      }),
    );
  }
  return amounts;
}

export function projectDriverFinancials(
  input: FinancialProjectionInput,
): DriverFinancialView {
  const view = projectFinancialView(input);
  return {
    ...view,
    incidentDisplay: incidentFinancialDisplay(view, input.incidents),
  };
}

function projectFinancialView(
  input: FinancialProjectionInput,
): DriverFinancialView {
  const { snapshot, now } = input;
  const fresh =
    input.lastError === null &&
    input.lastSuccessAt !== null &&
    now.getTime() >= input.lastSuccessAt.getTime() &&
    now.getTime() - input.lastSuccessAt.getTime() <= input.maxAgeSeconds * 1000;
  const view: DriverFinancialView = {
    contractVersion: 1,
    revision: input.revision,
    status: snapshot?.status ?? "unavailable",
    fresh,
    error: input.lastError,
    checkedAt: input.lastSuccessAt?.toISOString() ?? null,
    serverTime: now.toISOString(),
    maxAgeSeconds: input.maxAgeSeconds,
    currency: snapshot?.currency ?? null,
    lines: [],
    issues: [...(snapshot?.reasons ?? [])],
    totals: null,
    unpricedIncidentCount: input.incidents.filter(
      (incident) =>
        incident.status !== "canceled" && incident.lineIndex === null,
    ).length,
  };
  if (!snapshot || snapshot.status !== "ready" || !snapshot.shipmentAmounts)
    return view;
  const identities = financialLineIdentity(
    input.published,
    input.imported,
    snapshot,
  );
  if (!identities)
    return {
      ...view,
      status: "needs_review",
      issues: ["PUBLICATION_FINANCIAL_IDENTITY_CHANGED"],
    };
  try {
    return projectReadyFinancials(input, snapshot, identities, view);
  } catch (error) {
    if (
      error instanceof AppError &&
      error.code === "FINANCIAL_ALLOCATION_INVALID"
    )
      return { ...view, status: "needs_review", issues: [error.code] };
    throw error;
  }
}

function projectReadyFinancials(
  input: FinancialProjectionInput,
  snapshot: FinancialSnapshot,
  identities: FinancialSnapshot["lines"],
  view: DriverFinancialView,
): DriverFinancialView {
  const issues = new Set<string>(),
    amounts = sourceLineAmounts(snapshot);
  const lines: DriverFinancialLine[] = identities.map((move, lineIndex) => {
    const sale = snapshot.saleLines.find(
      (line) => line.id === move.saleLineId,
    )!;
    const original = amounts.get(move.id)!;
    const affected = incidentWeights(
      input.incidents,
      lineIndex,
      snapshot,
      move.id,
      move.saleLineId,
      move.quantity,
      issues,
    );
    const [net, deduction, deferred] = allocateFinancialAmount(
      original.total,
      affected.weights,
      snapshot.currency.rounding,
    );
    return {
      lineIndex,
      moveId: move.id,
      saleLineId: move.saleLineId,
      productId: move.productId,
      uomId: move.uomId,
      quantity: move.quantity,
      unit: move.uom,
      unitPrice: sale.unitPrice,
      discount: sale.discount,
      ...original,
      physicalRemaining: affected.physical,
      net,
      deduction,
      deferred,
    };
  });
  const totals = ["net", "deduction", "deferred"].map((key) =>
    sumFinancial(
      lines.map((line) => line[key as "net" | "deduction" | "deferred"]!),
    ),
  );
  const adjustment = snapshot.roundingAdjustment!;
  const portions = allocateFinancialAmount(
    adjustment,
    totals.map((value) => value.toFixed()),
    snapshot.currency.rounding,
  );
  const adjusted = totals.map((value, index) => value.plus(portions[index]));
  if (
    adjusted.some((value) => value.lt(0)) ||
    !sumFinancial(adjusted.map((value) => value.toFixed())).eq(
      snapshot.shipmentAmounts!.total,
    )
  )
    issues.add("FINANCIAL_ALLOCATION_INVALID");
  return {
    ...view,
    lines: issues.size
      ? lines.map((line) => ({
          ...line,
          net: null,
          deduction: null,
          deferred: null,
        }))
      : lines,
    issues: [...issues].sort(),
    totals: issues.size
      ? null
      : {
          original: snapshot.shipmentAmounts!.total,
          net: adjusted[0].toFixed(),
          deduction: adjusted[1].toFixed(),
          deferred: adjusted[2].toFixed(),
          roundingAdjustment: adjustment,
          remainingRoundingAdjustment: portions[0],
        },
  };
}
