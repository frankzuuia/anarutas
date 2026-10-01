import Decimal from "decimal.js";

type DisplayCurrency = { name: string; decimalPlaces: number };
const groups = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });

/** Format decimal strings without passing monetary values through binary floats. */
export function displayQuantity(value: string | number): string {
  const amount = new Decimal(value);
  if (!amount.isFinite()) return "Por confirmar";
  const [whole, fraction] = amount.abs().toFixed().split(".");
  return `${amount.isNegative() && !amount.isZero() ? "−" : ""}${groups.format(BigInt(whole))}${fraction ? `.${fraction}` : ""}`;
}

export function displayMoney(
  value: string | null | undefined,
  currency: DisplayCurrency | null,
): string {
  if (value == null || !currency) return "Por confirmar";
  const amount = new Decimal(value);
  if (!amount.isFinite()) return "Por confirmar";
  const [whole, fraction = ""] = amount.abs().toFixed().split(".");
  const decimals = fraction.padEnd(currency.decimalPlaces, "0");
  const symbol = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency.name,
  })
    .formatToParts(0)
    .find((part) => part.type === "currency")!.value;
  return `${amount.isNegative() && !amount.isZero() ? "−" : ""}${symbol}${groups.format(BigInt(whole))}${decimals ? `.${decimals}` : ""} ${currency.name}`;
}
