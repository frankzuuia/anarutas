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
it("validates both legacy tendered/change quanta even when net cash is exact and rejects negative source totals", () => {
  const rounded = {
    ...view,
    currency: { ...view.currency!, rounding: "0.05" },
  };
  expect(() =>
    calculatePayment(
      rounded,
      paymentInput(raw({ tendered: "123.46", change: "0.01" })),
    ),
  ).toThrow("PAYMENT_AMOUNT_INVALID");
  expect(() =>
    calculatePayment(
      { ...view, totals: { ...view.totals!, net: "-0.01" } },
      paymentInput(raw()),
    ),
  ).toThrow("PAYMENT_AMOUNT_INVALID");
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

it("captures the official full net amount and explicit components for each version-two method", () => {
  for (const method of ["cash", "transfer", "credit", "mixed"]) {
    const result = calculatePayment(
      view,
      paymentInput(
        raw({
          captureVersion: 2,
          method,
          tendered: method === "credit" ? "0" : "123.45",
          cashReceived: "50",
          transferReceived: "73.45",
        }),
      ),
    );
    expect(result).toEqual({
      expected: "123.45",
      tendered: method === "credit" ? "0" : "123.45",
      change: "0",
      received: method === "credit" ? "0" : "123.45",
      balance: method === "credit" ? "123.45" : "0",
      deferred: "10",
      cashReceived:
        method === "cash" ? "123.45" : method === "mixed" ? "50" : "0",
      transferReceived:
        method === "transfer" ? "123.45" : method === "mixed" ? "73.45" : "0",
    });
  }
  expect(paymentInput(raw())).not.toHaveProperty("captureVersion");
  expect(
    paymentInput(
      raw({
        captureVersion: 2,
        method: "mixed",
        cashReceived: "50.00",
        transferReceived: "73.450",
      }),
    ),
  ).toMatchObject({
    captureVersion: 2,
    cashReceived: "50",
    transferReceived: "73.45",
  });
});
it.each([
  [{ captureVersion: 1 }, "PAYMENT_CAPTURE_VERSION_INVALID"],
  [{ captureVersion: "2" }, "PAYMENT_CAPTURE_VERSION_INVALID"],
  [{ captureVersion: null }, "PAYMENT_CAPTURE_VERSION_INVALID"],
  [
    { method: "mixed", cashReceived: "50", transferReceived: "73.45" },
    "PAYMENT_CAPTURE_VERSION_INVALID",
  ],
  [
    {
      captureVersion: 2,
      method: "mixed",
      cashReceived: "",
      transferReceived: "73.45",
    },
    "PAYMENT_AMOUNT_INVALID",
  ],
  [
    {
      captureVersion: 2,
      method: "mixed",
      cashReceived: "50",
      transferReceived: null,
    },
    "PAYMENT_AMOUNT_INVALID",
  ],
  [
    {
      captureVersion: 2,
      method: "mixed",
      cashReceived: "-50",
      transferReceived: "173.45",
    },
    "PAYMENT_AMOUNT_INVALID",
  ],
])(
  "validates collection version and both explicit components %j",
  (patch, code) => {
    expect(() => paymentInput(raw(patch))).toThrow(code);
  },
);
it.each([
  [{ tendered: "100" }, "PAYMENT_FULL_AMOUNT_REQUIRED"],
  [{ method: "transfer", tendered: "0" }, "PAYMENT_FULL_AMOUNT_REQUIRED"],
  [{ tendered: "150", change: "26.55" }, "PAYMENT_FULL_AMOUNT_REQUIRED"],
  [
    { method: "mixed", cashReceived: "0", transferReceived: "123.45" },
    "PAYMENT_SPLIT_INVALID",
  ],
  [
    { method: "mixed", cashReceived: "123.45", transferReceived: "0" },
    "PAYMENT_SPLIT_INVALID",
  ],
  [
    { method: "mixed", cashReceived: "50", transferReceived: "73.44" },
    "PAYMENT_SPLIT_INVALID",
  ],
  [
    {
      method: "mixed",
      tendered: "100",
      cashReceived: "50",
      transferReceived: "50",
    },
    "PAYMENT_FULL_AMOUNT_REQUIRED",
  ],
  [
    { method: "mixed", cashReceived: "50.001", transferReceived: "73.449" },
    "PAYMENT_AMOUNT_INVALID",
  ],
  [
    { method: "mixed", cashReceived: "50.001", transferReceived: "73.45" },
    "PAYMENT_AMOUNT_INVALID",
  ],
])(
  "never rounds or silently accepts an incomplete collection %j",
  (patch, code) => {
    expect(() =>
      calculatePayment(
        view,
        paymentInput(raw({ captureVersion: 2, ...patch })),
      ),
    ).toThrow(code);
  },
);
it("separates combined cash and transfers in sums and handles full returns without requiring money", () => {
  const mixed = {
    ...calculatePayment(
      view,
      paymentInput(
        raw({
          captureVersion: 2,
          method: "mixed",
          cashReceived: "50",
          transferReceived: "73.45",
        }),
      ),
    ),
    method: "mixed" as const,
    currency: view.currency!,
  };
  expect(paymentTotals([mixed, mixed])[0]).toMatchObject({
    cash: "100",
    transfer: "146.9",
    credit: "0",
    balance: "0",
    deferred: "20",
  });
  for (const method of ["cash", "transfer", "credit"])
    expect(
      calculatePayment(
        { ...view, totals: { ...view.totals!, net: "0" } },
        paymentInput(raw({ captureVersion: 2, method, tendered: "0" })),
      ),
    ).toMatchObject({
      received: "0",
      cashReceived: "0",
      transferReceived: "0",
      balance: "0",
    });
  expect(() =>
    calculatePayment(
      {
        ...view,
        totals: { ...view.totals!, net: "123.43" },
        currency: { ...view.currency!, rounding: "0.05" },
      },
      paymentInput(raw({ captureVersion: 2, tendered: "123.43" })),
    ),
  ).toThrow("PAYMENT_AMOUNT_INVALID");
});
