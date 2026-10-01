import type { DriverFinancialView } from "./driver-financial-contract";
import { allocateFinancialAmount } from "./financial-allocation";
import { FinancialDecimal as D, sumFinancial } from "./financial-values";

export type DisplayIncident = {
  id: string;
  kind: string;
  status: string;
  quantity: string;
  financialMoveId: number | null;
  financialSaleLineId: number | null;
  replacementPayment: string | null;
};
export type IncidentAmounts = {
  id: string;
  deduction: string | null;
  deferred: string | null;
};

/** Read-only explanation of already allocated amounts. Never used to authorize a payment.
 * Stable IDs split currency remainders; move + sale line identity avoids product-name matches.
 * Order-level rounding remains explicit instead of inventing a discount on an incident. */
export function incidentFinancialDisplay(
  view: DriverFinancialView | null,
  incidents: DisplayIncident[],
) {
  const amounts: IncidentAmounts[] = incidents.map((incident) => ({
    id: incident.id,
    deduction: incident.status === "canceled" ? "0" : null,
    deferred: incident.status === "canceled" ? "0" : null,
  }));
  if (!view?.totals || !view.currency)
    return { amounts, deductionRounding: null, deferredRounding: null };
  for (const line of view.lines) {
    const selected = incidents
      .filter(
        (incident) =>
          incident.status !== "canceled" &&
          incident.financialMoveId === line.moveId &&
          incident.financialSaleLineId === line.saleLineId,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const field of ["deduction", "deferred"] as const) {
      if (line[field] === null) continue;
      const weights = selected.map((incident) => {
        const replacement =
          incident.kind === "replacement_quality" ||
          incident.kind === "replacement_wrong_product";
        const applies =
          field === "deduction"
            ? !replacement
            : replacement && incident.replacementPayment === "defer";
        return applies ? incident.quantity : "0";
      });
      // Legacy/missing identities must never acquire another incident's amount.
      if (sumFinancial(weights).isZero() && !new D(line[field]!).isZero())
        continue;
      const portions = allocateFinancialAmount(
        line[field]!,
        weights,
        view.currency.rounding,
      );
      selected.forEach((incident, index) => {
        amounts.find((item) => item.id === incident.id)![field] =
          portions[index];
      });
    }
  }
  return {
    amounts,
    deductionRounding: new D(view.totals.deduction)
      .minus(sumFinancial(view.lines.map((line) => line.deduction ?? "0")))
      .toFixed(),
    deferredRounding: new D(view.totals.deferred)
      .minus(sumFinancial(view.lines.map((line) => line.deferred ?? "0")))
      .toFixed(),
  };
}
