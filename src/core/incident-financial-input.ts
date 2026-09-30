import { AppError } from "./errors";
import type {
  IncidentFinancialReference,
  ReplacementPayment,
} from "./driver-financial-contract";

export type IncidentFinancialInput = {
  financialContractVersion?: 1;
  financial?: IncidentFinancialReference;
  replacementPayment?: ReplacementPayment;
};
function positiveIdentity(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new AppError("INVALID_FINANCIAL_INCIDENT");
  return value as number;
}
export function incidentFinancialInput(
  raw: Record<string, unknown>,
  kind: string,
): IncidentFinancialInput {
  if (raw.financialContractVersion === undefined) {
    if (raw.financial !== undefined || raw.replacementPayment !== undefined)
      throw new AppError("INVALID_FINANCIAL_INCIDENT");
    return {}; // Keep old queued command hashes byte-for-byte compatible.
  }
  if (raw.financialContractVersion !== 1)
    throw new AppError("INVALID_FINANCIAL_INCIDENT");
  const replacement =
    kind === "replacement_quality" || kind === "replacement_wrong_product";
  if (
    replacement
      ? !["pay_full", "defer"].includes(String(raw.replacementPayment))
      : raw.replacementPayment !== undefined
  )
    throw new AppError("REPLACEMENT_PAYMENT_REQUIRED");
  let financial: IncidentFinancialReference | undefined;
  if (raw.financial !== undefined) {
    if (
      !raw.financial ||
      typeof raw.financial !== "object" ||
      Array.isArray(raw.financial)
    )
      throw new AppError("INVALID_FINANCIAL_INCIDENT");
    const value = raw.financial as Record<string, unknown>;
    financial = {
      revision: positiveIdentity(value.revision),
      moveId: positiveIdentity(value.moveId),
      saleLineId: positiveIdentity(value.saleLineId),
    };
  }
  return {
    financialContractVersion: 1,
    ...(financial ? { financial } : {}),
    ...(replacement
      ? { replacementPayment: raw.replacementPayment as ReplacementPayment }
      : {}),
  };
}
