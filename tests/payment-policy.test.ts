import { expect, it } from "vitest";
import {
  paymentInput,
  calculatePayment,
  paymentTotals,
} from "../src/core/payment-policy";
import type { DriverFinancialView } from "../src/core/driver-financial-contract";
const view: DriverFinancialView = {
  contractVersion: 1,
  revision: 1,
  status: "ready",
  fresh: true,
  error: null,
  checkedAt: null,
  serverTime: "",
  maxAgeSeconds: 180,
  currency: { id: 1, name: "MXN", rounding: "0.01", decimalPlaces: 2 },
  lines: [],
  issues: [],
  unpricedIncidentCount: 0,
  totals: {
    original: "123.45",
    net: "123.45",
    deduction: "0",
    deferred: "10",
    roundingAdjustment: "0",
    remainingRoundingAdjustment: "0",
  },
};
const raw = (patch: Record<string, unknown> = {}) => ({
  method: "cash",
  tendered: "123.45",
  change: "0",
  note: "",
  basis: "a".repeat(64),
  ...patch,
});
it("records exact partial cash, complete transfer, credit and explicit cash change", () => {
  expect(
    calculatePayment(
      view,
      paymentInput(raw({ tendered: "73.45", note: "Resta 50" })),
    ),
  ).toEqual({
    expected: "123.45",
    received: "73.45",
    tendered: "73.45",
    change: "0",
    balance: "50",
    deferred: "10",
  });
  expect(
    calculatePayment(
      view,
      paymentInput(raw({ tendered: "150", change: "26.55" })),
    ),
  ).toMatchObject({ received: "123.45", balance: "0", change: "26.55" });
  expect(
    calculatePayment(
      view,
      paymentInput(raw({ method: "credit", tendered: "0" })),
    ),
  ).toMatchObject({ received: "0", balance: "123.45" });
  expect(
    calculatePayment(view, paymentInput(raw({ method: "transfer" }))),
  ).toMatchObject({ received: "123.45", balance: "0" });
});
it.each([
  [raw({ tendered: "-1" }), "PAYMENT_AMOUNT_INVALID"],
  [raw({ method: "other" }), "PAYMENT_METHOD_REQUIRED"],
  [raw({ method: null }), "PAYMENT_METHOD_REQUIRED"],
  [raw({ tendered: 1 }), "PAYMENT_AMOUNT_INVALID"],
  [raw({ tendered: "NaN" }), "PAYMENT_AMOUNT_INVALID"],
  [raw({ tendered: "Infinity" }), "PAYMENT_AMOUNT_INVALID"],
  [raw({ note: 4 }), "PAYMENT_NOTE_INVALID"],
  [raw({ note: "a".repeat(2001) }), "PAYMENT_NOTE_INVALID"],
  [raw({ basis: "" }), "PAYMENT_BASIS_REQUIRED"],
  [raw({ basis: null }), "PAYMENT_BASIS_REQUIRED"],
])("rejects malformed input with an actionable error %j", (input, code) =>
  expect(() => paymentInput(input as Record<string, unknown>)).toThrow(
    code as string,
  ),
);
it.each([
  [{ tendered: "124" }, "PAYMENT_CHANGE_INVALID"],
  [{ tendered: "100", change: "1" }, "PAYMENT_CHANGE_INVALID"],
  [{ tendered: "1", change: "2" }, "PAYMENT_CHANGE_INVALID"],
  [
    { method: "transfer", tendered: "124.45", change: "1" },
    "PAYMENT_CHANGE_INVALID",
  ],
  [{ method: "credit", tendered: "1" }, "CREDIT_RECEIVED_MUST_BE_ZERO"],
  [{ tendered: "0.001" }, "PAYMENT_AMOUNT_INVALID"],
])("rejects invalid money relationship %j", (patch, code) =>
  expect(() =>
    calculatePayment(view, paymentInput(raw(patch as Record<string, unknown>))),
  ).toThrow(code as string),
);
it("preserves the note boundary, normalizes whitespace and rejects non-string methods", () => {
  expect(paymentInput(raw({ note: "a".repeat(2000) })).note).toHaveLength(2000);
  expect(paymentInput(raw({ note: "  Quedan 50  " })).note).toBe("Quedan 50");
  expect(() =>
    paymentInput(raw({ method: { toString: () => "cash" } })),
  ).toThrow("PAYMENT_METHOD_REQUIRED");
});
it("blocks unready/stale/errored sources and accepts exact zero after full return", () => {
  for (const patch of [
    { status: "pending_validation" },
    { fresh: false },
    { error: "ODOO_TIMEOUT" },
    { totals: null },
    { currency: null },
    { issues: ["MISMATCH"] },
  ] as Partial<DriverFinancialView>[])
    expect(() =>
      calculatePayment({ ...view, ...patch }, paymentInput(raw())),
    ).toThrow(
      patch.fresh === false || patch.error
        ? "FINANCIAL_SOURCE_STALE"
        : "FINANCIAL_SOURCE_NOT_READY",
    );
  expect(
    calculatePayment(
      { ...view, totals: { ...view.totals!, net: "0" } },
      paymentInput(raw({ tendered: "0" })),
    ),
  ).toMatchObject({ received: "0", balance: "0" });
});
it("does not combine currencies or credit with physical cash", () => {
  const cash = {
    ...calculatePayment(view, paymentInput(raw({ tendered: "73.45" }))),
    currency: view.currency!,
    method: "cash" as const,
  };
  const credit = {
    ...cash,
    method: "credit" as const,
    received: "0",
    balance: "123.45",
  };
  const transfer = { ...cash, method: "transfer" as const };
  expect(
    paymentTotals([
      cash,
      credit,
      transfer,
      { ...cash, currency: { ...cash.currency, id: 2, name: "USD" } },
    ]),
  ).toEqual([
    {
      currency: view.currency,
      cash: "73.45",
      transfer: "73.45",
      credit: "123.45",
      balance: "100",
      deferred: "30",
    },
    {
      currency: { ...view.currency!, id: 2, name: "USD" },
      cash: "73.45",
      transfer: "0",
      credit: "0",
      balance: "50",
      deferred: "10",
    },
  ]);
});
