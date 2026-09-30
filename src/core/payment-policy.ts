import { AppError } from "./errors";
import {
  financialDecimal,
  FinancialDecimal as D,
  sumFinancial,
} from "./financial-values";
import type { DriverFinancialView } from "./driver-financial-contract";
import type { FinancialCurrency } from "./financial-contract";

export type PaymentMethod = "cash" | "transfer" | "credit";
export type PaymentAmounts = {
  expected: string;
  received: string;
  tendered: string;
  change: string;
  balance: string;
  deferred: string;
};
export type PaymentSummaryItem = PaymentAmounts & {
  method: PaymentMethod;
  currency: FinancialCurrency;
};
export function paymentInput(raw: Record<string, unknown>) {
  if (
    typeof raw.method !== "string" ||
    !["cash", "transfer", "credit"].includes(raw.method)
  )
    throw new AppError("PAYMENT_METHOD_REQUIRED");
  const amount = (value: unknown) => {
    if (typeof value !== "string") throw new AppError("PAYMENT_AMOUNT_INVALID");
    try {
      const parsed = financialDecimal(value);
      if (new D(parsed).lt(0)) throw new Error();
      return parsed;
    } catch {
      throw new AppError("PAYMENT_AMOUNT_INVALID");
    }
  };
  if (typeof raw.note !== "string" || raw.note.length > 2000)
    throw new AppError("PAYMENT_NOTE_INVALID");
  if (typeof raw.basis !== "string" || raw.basis.length !== 64)
    throw new AppError("PAYMENT_BASIS_REQUIRED");
  return {
    method: raw.method as PaymentMethod,
    tendered: amount(raw.tendered),
    change: amount(raw.change),
    note: raw.note.trim(),
    basis: raw.basis,
  };
}
export function calculatePayment(
  view: DriverFinancialView,
  input: ReturnType<typeof paymentInput>,
): PaymentAmounts {
  if (
    view.status !== "ready" ||
    !view.totals ||
    !view.currency ||
    view.issues.length
  )
    throw new AppError("FINANCIAL_SOURCE_NOT_READY", 409);
  if (!view.fresh || view.error)
    throw new AppError("FINANCIAL_SOURCE_STALE", 409);
  const tendered = new D(input.tendered),
    change = new D(input.change),
    expected = new D(view.totals.net);
  const step = new D(view.currency.rounding);
  if (
    [tendered, change, expected].some(
      (value) => value.lt(0) || !value.mod(step).isZero(),
    )
  )
    throw new AppError("PAYMENT_AMOUNT_INVALID");
  if (input.method !== "cash" && !change.isZero())
    throw new AppError("PAYMENT_CHANGE_INVALID");
  if (input.method === "credit" && !tendered.isZero())
    throw new AppError("CREDIT_RECEIVED_MUST_BE_ZERO");
  const received = tendered.minus(change);
  if (received.lt(0) || received.gt(expected))
    throw new AppError("PAYMENT_CHANGE_INVALID");
  if (!change.isZero() && !received.eq(expected))
    throw new AppError("PAYMENT_CHANGE_INVALID");
  return {
    expected: expected.toFixed(),
    tendered: tendered.toFixed(),
    change: change.toFixed(),
    received: received.toFixed(),
    balance: expected.minus(received).toFixed(),
    deferred: view.totals.deferred,
  };
}
export function paymentTotals(items: PaymentSummaryItem[]) {
  const currencies = new Map(
    items.map((item) => [
      `${item.currency.id}:${item.currency.name}`,
      item.currency,
    ]),
  );
  return [...currencies.entries()].map(([key, currency]) => {
    const rows = items.filter(
      (item) => `${item.currency.id}:${item.currency.name}` === key,
    );
    return {
      currency,
      cash: sumFinancial(
        rows.filter((r) => r.method === "cash").map((r) => r.received),
      ).toFixed(),
      transfer: sumFinancial(
        rows.filter((r) => r.method === "transfer").map((r) => r.received),
      ).toFixed(),
      credit: sumFinancial(
        rows.filter((r) => r.method === "credit").map((r) => r.expected),
      ).toFixed(),
      balance: sumFinancial(
        rows.filter((r) => r.method !== "credit").map((r) => r.balance),
      ).toFixed(),
      deferred: sumFinancial(rows.map((r) => r.deferred)).toFixed(),
    };
  });
}
