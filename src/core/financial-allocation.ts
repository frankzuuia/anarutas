import { AppError } from "./errors";
import { FinancialDecimal as D } from "./financial-values";

function coefficient(value: InstanceType<typeof D>) {
  const [whole, fraction = ""] = value.abs().toFixed().split(".");
  return { value: BigInt(whole + fraction), scale: fraction.length };
}
function decimal(value: bigint, scale: number, negative: boolean): string {
  const digits = value.toString().padStart(scale + 1, "0");
  const text = scale
    ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
    : digits;
  return new D(`${negative ? "-" : ""}${text}`).toFixed();
}

/** Exact integer rational remainders in real currency increments; stable tie order. */
export function allocateFinancialAmount(
  total: string,
  weights: string[],
  step: string,
): string[] {
  const amount = new D(total),
    increment = new D(step);
  const values = weights.map((weight) => new D(weight));
  if (
    !amount.isFinite() ||
    !increment.isFinite() ||
    increment.lte(0) ||
    values.some((value) => !value.isFinite() || value.lt(0))
  )
    throw new AppError("FINANCIAL_ALLOCATION_INVALID", 502);
  const money = coefficient(amount),
    quantum = coefficient(increment);
  const scale = Math.max(money.scale, quantum.scale);
  const numerator = money.value * 10n ** BigInt(scale - money.scale);
  const denominator = quantum.value * 10n ** BigInt(scale - quantum.scale);
  if (numerator % denominator !== 0n)
    throw new AppError("FINANCIAL_ALLOCATION_INVALID", 502);
  const units = numerator / denominator;
  const counts = values.map(coefficient),
    countScale = Math.max(0, ...counts.map((count) => count.scale));
  const integers = counts.map(
    (count) => count.value * 10n ** BigInt(countScale - count.scale),
  );
  const sum = integers.reduce((acc, value) => acc + value, 0n);
  if (units === 0n) return values.map(() => "0");
  if (sum === 0n) throw new AppError("FINANCIAL_ALLOCATION_INVALID", 502);
  const shares = integers.map((weight, index) => ({
    index,
    whole: (units * weight) / sum,
    remainder: (units * weight) % sum,
  }));
  const remaining =
    units - shares.reduce((acc, share) => acc + share.whole, 0n);
  const priority = [...shares].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (let index = 0; BigInt(index) < remaining; index++)
    priority[index].whole += 1n;
  return shares.map((share) =>
    decimal(share.whole * quantum.value, quantum.scale, amount.isNegative()),
  );
}
