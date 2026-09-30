import Decimal from "decimal.js";
import { AppError } from "./errors";

// Odoo JSON floats have at most 17 significant digits. 80 leaves ample headroom
// for quantities * prices * discounts and sums, without binary float arithmetic.
export const FinancialDecimal = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_UP,
});
export function financialDecimal(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string")
    throw new AppError("FINANCIAL_DECIMAL_INVALID", 502);
  try {
    if (typeof value === "string" && (!value.trim() || value.length > 80))
      throw new Error();
    const result = new FinancialDecimal(value);
    if (!result.isFinite() || result.sd() > 32 || Math.abs(result.e) > 24)
      throw new Error();
    return result.toFixed();
  } catch {
    throw new AppError("FINANCIAL_DECIMAL_INVALID", 502);
  }
}
export function roundFinancial(value: Decimal.Value, rounding: string) {
  const step = new FinancialDecimal(rounding);
  if (step.lte(0) || !step.isFinite())
    throw new AppError("FINANCIAL_CURRENCY_INVALID", 502);
  return new FinancialDecimal(value).div(step).toDecimalPlaces(0).mul(step);
}
export function sumFinancial(values: string[]) {
  return values.reduce(
    (sum, value) => sum.plus(value),
    new FinancialDecimal(0),
  );
}
