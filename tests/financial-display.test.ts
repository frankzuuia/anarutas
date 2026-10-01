import { expect, it } from "vitest";
import { displayMoney, displayQuantity } from "../src/core/financial-display";
import {
  incidentFinancialDisplay,
  type DisplayIncident,
} from "../src/core/incident-financial-display";
import type { DriverFinancialView } from "../src/core/driver-financial-contract";

const currency = { id: 1, name: "MXN", decimalPlaces: 2, rounding: "0.01" };
function view(): DriverFinancialView {
  return {
    contractVersion: 1,
    revision: 1,
    status: "ready",
    fresh: true,
    error: null,
    checkedAt: null,
    serverTime: "2026-10-01T12:00:00Z",
    maxAgeSeconds: 180,
    currency,
    issues: [],
    unpricedIncidentCount: 0,
    lines: [
      {
        lineIndex: 0,
        moveId: 100,
        saleLineId: 10,
        productId: 2,
        uomId: 1,
        quantity: "5",
        unit: "Unidades",
        unitPrice: "40",
        discount: "0",
        untaxed: "200",
        tax: "0",
        total: "200",
        physicalRemaining: "1",
        deduction: "160",
        deferred: "0",
        net: "40",
      },
    ],
    totals: {
      original: "200",
      deduction: "160",
      deferred: "0",
      net: "40",
      roundingAdjustment: "0",
      remainingRoundingAdjustment: "0",
    },
  };
}
function incident(overrides: Partial<DisplayIncident> = {}): DisplayIncident {
  return {
    id: "a",
    kind: "return",
    status: "pending",
    quantity: "4",
    financialMoveId: 100,
    financialSaleLineId: 10,
    replacementPayment: null,
    ...overrides,
  };
}
it("formats money without losing cents, large integers, tiny unit prices or currency precision", () => {
  expect(displayMoney("1086.500000", currency)).toBe("$1,086.50 MXN");
  expect(displayMoney("9007199254740993.01", currency)).toBe(
    "$9,007,199,254,740,993.01 MXN",
  );
  expect(displayMoney("0.000001", currency)).toBe("$0.000001 MXN");
  expect(displayMoney("-0.01", currency)).toBe("−$0.01 MXN");
  expect(displayMoney("-0", currency)).toBe("$0.00 MXN");
  expect(displayMoney("1000", { name: "JPY", decimalPlaces: 0 })).toBe(
    "JPY1,000 JPY",
  );
  expect(displayMoney(null, currency)).toBe("Por confirmar");
  expect(displayMoney(undefined, currency)).toBe("Por confirmar");
  expect(displayMoney("1", null)).toBe("Por confirmar");
  expect(displayMoney("NaN", currency)).toBe("Por confirmar");
  expect(displayQuantity("4.000000")).toBe("4");
  expect(displayQuantity("3.200000")).toBe("3.2");
  expect(displayQuantity("-1000.000001")).toBe("−1,000.000001");
  expect(displayQuantity("-0")).toBe("0");
  expect(displayQuantity("Infinity")).toBe("Por confirmar");
});
it("explains the already allocated return and preserves the source", () => {
  const financial = view(),
    before = structuredClone(financial);
  expect(incidentFinancialDisplay(financial, [incident()])).toEqual({
    amounts: [{ id: "a", deduction: "160", deferred: "0" }],
    deductionRounding: "0",
    deferredRounding: "0",
  });
  expect(financial).toEqual(before);
});
it("splits cents by stable incident identity, never by matching product names", () => {
  const financial = view();
  financial.lines[0].deduction = "0.01";
  financial.totals!.deduction = "0.02";
  const cases = [
    incident({ id: "b", quantity: "1" }),
    incident({ quantity: "1" }),
    incident({ id: "wrong-sale", financialSaleLineId: 11 }),
    incident({ id: "wrong-move", financialMoveId: 101 }),
  ];
  const result = incidentFinancialDisplay(financial, cases);
  expect(result.amounts).toEqual([
    { id: "b", deduction: "0", deferred: "0" },
    { id: "a", deduction: "0.01", deferred: "0" },
    { id: "wrong-sale", deduction: null, deferred: null },
    { id: "wrong-move", deduction: null, deferred: null },
  ]);
  expect(result.deductionRounding).toBe("0.01");
  expect(
    incidentFinancialDisplay(financial, [...cases].reverse()).amounts.find(
      (item) => item.id === "a",
    )?.deduction,
  ).toBe("0.01");
});
it("separates replacements paid later, paid now, and canceled incidents", () => {
  const financial = view();
  financial.lines[0].deduction = "0";
  financial.lines[0].deferred = "40";
  financial.totals!.deduction = "0";
  financial.totals!.deferred = "39.99";
  const result = incidentFinancialDisplay(financial, [
    incident({
      kind: "replacement_quality",
      replacementPayment: "defer",
      quantity: "1",
    }),
    incident({
      id: "b",
      kind: "replacement_wrong_product",
      replacementPayment: "pay_full",
    }),
    incident({ id: "c", status: "canceled" }),
  ]);
  expect(result.amounts).toEqual([
    { id: "a", deduction: "0", deferred: "40" },
    { id: "b", deduction: "0", deferred: "0" },
    { id: "c", deduction: "0", deferred: "0" },
  ]);
  expect(result.deferredRounding).toBe("-0.01");
});
it("keeps unavailable and unmatched discounts unknown, including older receipts", () => {
  expect(
    incidentFinancialDisplay(null, [
      incident(),
      incident({ id: "c", status: "canceled" }),
    ]),
  ).toEqual({
    amounts: [
      { id: "a", deduction: null, deferred: null },
      { id: "c", deduction: "0", deferred: "0" },
    ],
    deductionRounding: null,
    deferredRounding: null,
  });
  const financial = view();
  financial.currency = null;
  expect(
    incidentFinancialDisplay(financial, [incident()]).deductionRounding,
  ).toBeNull();
  financial.currency = currency;
  financial.totals = null;
  expect(
    incidentFinancialDisplay(financial, [incident()]).amounts[0].deduction,
  ).toBeNull();
  financial.totals = view().totals;
  financial.lines[0].deduction = null;
  financial.lines[0].deferred = null;
  expect(
    incidentFinancialDisplay(financial, [incident()]).amounts[0].deduction,
  ).toBeNull();
  financial.lines[0].deduction = "160";
  expect(
    incidentFinancialDisplay(financial, [
      incident({ kind: "replacement_quality", replacementPayment: "pay_full" }),
    ]).amounts[0].deduction,
  ).toBeNull();
  expect(incidentFinancialDisplay(view(), []).amounts).toEqual([]);
});

it("never includes canceled quantities in another return's discount", () => {
  const result = incidentFinancialDisplay(view(), [
    incident(),
    incident({ id: "canceled", status: "canceled", quantity: "4" }),
  ]);
  expect(result.amounts).toEqual([
    { id: "a", deduction: "160", deferred: "0" },
    { id: "canceled", deduction: "0", deferred: "0" },
  ]);
});

it("a wrong-product replacement defers its amount without taking a return discount", () => {
  const financial = view();
  financial.lines[0].deduction = "80";
  financial.lines[0].deferred = "80";
  financial.totals!.deduction = "80";
  financial.totals!.deferred = "80";
  expect(
    incidentFinancialDisplay(financial, [
      incident({ quantity: "2" }),
      incident({
        id: "replacement",
        quantity: "2",
        kind: "replacement_wrong_product",
        replacementPayment: "defer",
      }),
    ]).amounts,
  ).toEqual([
    { id: "a", deduction: "80", deferred: "0" },
    { id: "replacement", deduction: "0", deferred: "80" },
  ]);
});
