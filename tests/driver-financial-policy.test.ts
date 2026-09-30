import { expect, it } from "vitest";
import { allocateFinancialAmount } from "../src/core/financial-allocation";
import {
  financialIncidentBasis,
  financialLineIdentity,
  projectDriverFinancials,
} from "../src/core/driver-financial-policy";
import { buildFinancialSnapshot } from "../src/core/financial-policy";
import {
  FinancialDecimal as D,
  sumFinancial,
} from "../src/core/financial-values";
import { financialObservation, financialTarget } from "./helpers/financial";
import type {
  FinancialIncidentRow,
  FinancialProjectionInput,
} from "../src/core/driver-financial-contract";
import { incidentFinancialInput } from "../src/core/incident-financial-input";
import { productIncidentInput } from "../src/core/product-incidents-policy";

it("rejects invalid weights even when the amount is zero and orders unequal remainders", () => {
  expect(allocateFinancialAmount("0.03", ["1", "0.5"], "0.01")).toEqual([
    "0.02",
    "0.01",
  ]);
  expect(allocateFinancialAmount("0.11", ["0.1", "0.01"], "0.01")).toEqual([
    "0.1",
    "0.01",
  ]);
  expect(allocateFinancialAmount("0.02", ["1", "2"], "0.01")).toEqual([
    "0.01",
    "0.01",
  ]);
  for (const weight of ["-1", "NaN", "Infinity", "-Infinity"])
    expect(() => allocateFinancialAmount("0", [weight], "0.01")).toThrow(
      "FINANCIAL_ALLOCATION_INVALID",
    );
  expect(allocateFinancialAmount("0.01", ["1", "2"], "0.01")).toEqual([
    "0",
    "0.01",
  ]);
  expect(allocateFinancialAmount("0.01", ["2", "1"], "0.01")).toEqual([
    "0.01",
    "0",
  ]);
  expect(allocateFinancialAmount("0.01", ["0", "1", "1"], "0.01")).toEqual([
    "0",
    "0.01",
    "0",
  ]);
});

it("conserves very large integer currency units and exact tiny increments", () => {
  const total = "9".repeat(77) + ".99";
  const result = allocateFinancialAmount(
    total,
    ["1", "1.000000000000000000000000001", "0"],
    "0.01",
  );
  const units = result.map((value) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  });
  expect(units.reduce((a, b) => a + b, 0n)).toBe(
    BigInt(total.replace(".", "")),
  );
  expect(result[2]).toBe("0");
  expect(
    allocateFinancialAmount(
      "0.000000000000000000000001",
      ["1", "2"],
      "0.000000000000000000000001",
    ),
  ).toEqual(["0", "0.000000000000000000000001"]);
});

it("verifies each independent identity boundary and every line in a multi-line publication", () => {
  const original = input();
  for (const alter of [
    (i: FinancialProjectionInput) => {
      i.published.push({ ...i.published[0] });
    },
    (i: FinancialProjectionInput) => {
      i.snapshot!.lines.push({ ...i.snapshot!.lines[0], id: 101 });
    },
    (i: FinancialProjectionInput) => {
      i.snapshot!.lines = [];
    },
  ]) {
    const i = structuredClone(original);
    alter(i);
    expect(
      financialLineIdentity(i.published, i.imported, i.snapshot!),
    ).toBeNull();
  }
  const i = input();
  i.published.push({ ...i.published[0] });
  i.imported.push({ ...i.imported[0], moveId: 101 });
  i.snapshot!.lines.push({ ...i.snapshot!.lines[0], id: 101 });
  i.imported[1].productId = 999;
  expect(
    financialLineIdentity(i.published, i.imported, i.snapshot!),
  ).toBeNull();
  i.imported[1] = { ...i.imported[0] };
  expect(
    financialLineIdentity(i.published, i.imported, i.snapshot!),
  ).toBeNull();
  i.imported[1].moveId = 101;
  i.snapshot!.lines[1].id = 100;
  expect(
    financialLineIdentity(i.published, i.imported, i.snapshot!),
  ).toBeNull();
});

it("includes sibling stock movements in incident valuation evidence independent of ordering", () => {
  const i = input(),
    snapshot = i.snapshot!;
  snapshot.lines.push({ ...snapshot.lines[0], id: 101, quantity: "1" });
  const basis = financialIncidentBasis(snapshot, 100);
  expect(typeof basis).toBe("string");
  snapshot.lines.reverse();
  expect(financialIncidentBasis(snapshot, 100)).toBe(basis);
  snapshot.lines[0].quantity = "1.01";
  expect(financialIncidentBasis(snapshot, 100)).not.toBe(basis);
});

it("allocates each commercial sale independently and excludes section lines", () => {
  const i = input(),
    s = i.snapshot!;
  s.saleLines.push({
    ...structuredClone(s.saleLines[0]),
    id: 11,
    productId: 3,
    amounts: { untaxed: "6", tax: "0.96", total: "6.96" },
    unitPrice: "3",
    taxIds: [7],
  });
  s.saleLines.push({
    ...structuredClone(s.saleLines[0]),
    id: 12,
    displayType: "line_section",
    amounts: { untaxed: "0", tax: "0", total: "0" },
  });
  s.lines.push({ ...s.lines[0], id: 101, saleLineId: 11, productId: 3 });
  i.imported.push({ ...i.imported[0], moveId: 101, productId: 3 });
  i.published.push({ ...i.published[0] });
  s.shipmentAmounts = { untaxed: "26", tax: "0.96", total: "26.96" };
  const result = projectDriverFinancials(i);
  expect(result.issues).toEqual([]);
  expect(result.lines.map((line) => line.total)).toEqual(["20", "6.96"]);
  expect(result.lines.map((line) => line.tax)).toEqual(["0", "0.96"]);
  expect(result.lines.map((line) => line.unitPrice)).toEqual(["10", "3"]);
  expect(result.totals!.net).toBe("26.96");
  const independentBasis = financialIncidentBasis(s, 100);
  const basis = financialIncidentBasis(s, 101);
  s.saleLines[1].unitPrice = "4";
  expect(financialIncidentBasis(s, 101)).not.toBe(basis);
  s.lines[1].quantity = "3";
  expect(financialIncidentBasis(s, 100)).toBe(independentBasis);
});

it("reports observation metadata and excludes canceled manual incidents from unpriced counts", () => {
  const i = input();
  i.incidents = [
    incident(i, { lineIndex: null, status: "canceled" }),
    incident(i),
    incident(i, { id: "manual", lineIndex: null }),
    incident(i, { id: "manual-2", lineIndex: null }),
  ];
  expect(projectDriverFinancials(i)).toMatchObject({
    checkedAt: i.lastSuccessAt!.toISOString(),
    serverTime: i.now.toISOString(),
    maxAgeSeconds: 180,
    unpricedIncidentCount: 2,
    issues: [],
  });
  i.snapshot!.status = "needs_review";
  i.snapshot!.reasons = ["AMOUNT_MISMATCH"];
  expect(projectDriverFinancials(i).issues).toEqual(["AMOUNT_MISMATCH"]);
  i.snapshot!.status = "ready";
  i.snapshot!.shipmentAmounts = null;
  expect(projectDriverFinancials(i).totals).toBeNull();
});

it("fails closed when global adjustment would produce a negative amount or mismatched total", () => {
  const i = input();
  i.snapshot!.shipmentAmounts!.total = "21";
  expect(projectDriverFinancials(i)).toMatchObject({
    totals: null,
    issues: ["FINANCIAL_ALLOCATION_INVALID"],
  });
  i.snapshot!.roundingAdjustment = "-21";
  i.snapshot!.shipmentAmounts!.total = "-1";
  expect(projectDriverFinancials(i)).toMatchObject({
    totals: null,
    issues: ["FINANCIAL_ALLOCATION_INVALID"],
  });
});

function input(): FinancialProjectionInput {
  const observation = financialObservation();
  return {
    revision: 1,
    snapshot: buildFinancialSnapshot(financialTarget, observation),
    now: new Date("2026-09-30T16:00:00Z"),
    lastSuccessAt: new Date("2026-09-30T16:00:00Z"),
    lastError: null,
    maxAgeSeconds: 180,
    published: [{ name: "Producto", quantity: 2, unit: "kg" }],
    imported: [
      { moveId: 100, productId: 2, name: "Producto", quantity: 2, unit: "kg" },
    ],
    incidents: [],
  };
}
function incident(
  i: FinancialProjectionInput,
  patch: Partial<FinancialIncidentRow> = {},
): FinancialIncidentRow {
  return {
    id: "incident-1",
    lineIndex: 0,
    kind: "return",
    quantity: "1",
    status: "pending",
    financialRevision: 1,
    financialMoveId: 100,
    financialSaleLineId: 10,
    financialSnapshot: structuredClone(i.snapshot),
    replacementPayment: null,
    ...patch,
  };
}

it("allocates exact increments with stable ties, negative adjustments and zero weights", () => {
  expect(allocateFinancialAmount("0.05", ["1", "1", "1"], "0.01")).toEqual([
    "0.02",
    "0.02",
    "0.01",
  ]);
  expect(allocateFinancialAmount("-0.05", ["1", "1", "1"], "0.01")).toEqual([
    "-0.02",
    "-0.02",
    "-0.01",
  ]);
  expect(allocateFinancialAmount("0.15", ["0", "1", "2"], "0.05")).toEqual([
    "0",
    "0.05",
    "0.1",
  ]);
  expect(allocateFinancialAmount("0", ["0", "0"], "1")).toEqual(["0", "0"]);
  expect(allocateFinancialAmount("0", [], "1")).toEqual([]);
  expect(
    allocateFinancialAmount("99999999999999999999.99", ["1", "0"], "0.01"),
  ).toEqual(["99999999999999999999.99", "0"]);
  for (const total of ["1", "0.01", "-10.21", "999999999999.99"])
    for (let count = 1; count <= 9; count++) {
      const weights = Array.from({ length: count }, (_, index) =>
        String(index + 1),
      );
      const allocated = allocateFinancialAmount(total, weights, "0.01");
      expect(sumFinancial(allocated).toFixed()).toBe(total);
      expect(
        allocated.every((value) => new D(value).div("0.01").isInteger()),
      ).toBe(true);
    }
});
it.each([
  ["NaN", ["1"], "0.01"],
  ["Infinity", ["1"], "1"],
  ["1", ["1"], "0"],
  ["1", ["1"], "-1"],
  ["1", ["1"], "Infinity"],
  ["1", ["-1"], "1"],
  ["1", ["NaN"], "1"],
  ["1", ["0"], "1"],
  ["1", [], "1"],
  ["0.001", ["1"], "0.01"],
] as [string, string[], string][])(
  "rejects impossible allocations %s %s %s",
  (total, weights, step) => {
    expect(() => allocateFinancialAmount(total, weights, step)).toThrow(
      "FINANCIAL_ALLOCATION_INVALID",
    );
  },
);
it("uses original ordered identity only to recover IDs, then final quantities by move ID", () => {
  const i = input();
  i.snapshot!.lines[0].quantity = "2.12";
  expect(
    financialLineIdentity(i.published, i.imported, i.snapshot!)?.[0].quantity,
  ).toBe("2.12");
  for (const field of ["name", "quantity", "unit"] as const) {
    const changed = structuredClone(i);
    Object.assign(changed.published[0], {
      [field]: field === "quantity" ? 3 : "Changed",
    });
    expect(projectDriverFinancials(changed).issues).toContain(
      "PUBLICATION_FINANCIAL_IDENTITY_CHANGED",
    );
  }
  for (const field of ["moveId", "productId", "uomId", "saleLineId"] as const) {
    const changed = structuredClone(i);
    changed.imported[0][field] = 555;
    expect(
      financialLineIdentity(
        changed.published,
        changed.imported,
        changed.snapshot!,
      ),
    ).toBeNull();
  }
  i.imported[0].saleLineId = 10;
  i.imported[0].uomId = 3;
  expect(
    financialLineIdentity(i.published, i.imported, i.snapshot!),
  ).not.toBeNull();
  i.published.push(i.published[0]);
  i.imported.push(i.imported[0]);
  i.snapshot!.lines.push(i.snapshot!.lines[0]);
  expect(
    financialLineIdentity(i.published, i.imported, i.snapshot!),
  ).toBeNull();
  i.imported.pop();
  expect(
    financialLineIdentity(i.published, i.imported, i.snapshot!),
  ).toBeNull();
});
it("exposes exact official unit price, discounts and original totals", () => {
  const i = input();
  const result = projectDriverFinancials(i);
  expect(result).toMatchObject({
    status: "ready",
    fresh: true,
    issues: [],
    revision: 1,
    totals: {
      original: "20",
      deduction: "0",
      deferred: "0",
      net: "20",
      roundingAdjustment: "0",
    },
  });
  expect(result.lines[0]).toMatchObject({
    moveId: 100,
    saleLineId: 10,
    quantity: "2",
    unitPrice: "10",
    total: "20",
    physicalRemaining: "2",
  });
});
it.each(["return", "shortage_validation", "shortage_warehouse"])(
  "deducts linked %s and returns exactly zero on full quantity",
  (kind) => {
    const i = input();
    i.incidents = [incident(i, { kind, quantity: "0.125" })];
    expect(projectDriverFinancials(i)).toMatchObject({
      totals: { deduction: "1.25", net: "18.75" },
      lines: [{ physicalRemaining: "1.875" }],
    });
    i.incidents[0].quantity = "2";
    expect(projectDriverFinancials(i).totals).toMatchObject({
      deduction: "20",
      net: "0",
      deferred: "0",
    });
  },
);
it.each(["replacement_quality", "replacement_wrong_product"])(
  "separates physical quantity and explicit payment for %s",
  (kind) => {
    const i = input();
    i.incidents = [incident(i, { kind, replacementPayment: "pay_full" })];
    expect(projectDriverFinancials(i)).toMatchObject({
      totals: { deduction: "0", deferred: "0", net: "20" },
      lines: [{ physicalRemaining: "1" }],
    });
    i.incidents[0].replacementPayment = "defer";
    expect(projectDriverFinancials(i).totals).toMatchObject({
      deferred: "10",
      net: "10",
    });
    i.incidents[0].replacementPayment = null;
    expect(projectDriverFinancials(i)).toMatchObject({
      totals: null,
      issues: ["REPLACEMENT_PAYMENT_REQUIRED"],
    });
  },
);
it("keeps resolved effects, reverses cancellations and leaves manual shortages unpriced", () => {
  const i = input();
  i.incidents = [
    incident(i, { status: "resolved" }),
    incident(i, { id: "manual", lineIndex: null, financialSnapshot: null }),
  ];
  expect(projectDriverFinancials(i)).toMatchObject({
    unpricedIncidentCount: 1,
    totals: { deduction: "10" },
  });
  i.incidents[0].status = "canceled";
  expect(projectDriverFinancials(i).totals).toMatchObject({
    deduction: "0",
    net: "20",
  });
});
it("fails closed for legacy evidence, mismatched revisions and oversubscribed physical quantity", () => {
  for (const patch of [
    { financialSnapshot: null },
    { financialRevision: null },
    { financialMoveId: 2 },
    { financialSaleLineId: 2 },
  ]) {
    const i = input();
    i.incidents = [incident(i, patch)];
    expect(projectDriverFinancials(i)).toMatchObject({
      totals: null,
      issues: ["INCIDENT_FINANCIAL_REVIEW_REQUIRED"],
      lines: [{ net: null }],
    });
  }
  const i = input();
  i.incidents = [incident(i, { quantity: "2.01" })];
  expect(projectDriverFinancials(i)).toMatchObject({
    totals: null,
    issues: ["INCIDENT_QUANTITY_EXCEEDED"],
    lines: [{ physicalRemaining: "0" }],
  });
});
it("equivalent refresh retains valuation; price, quantity, tax, currency or identity changes require review", () => {
  const i = input();
  i.incidents = [incident(i)];
  i.revision = 2;
  i.snapshot!.order.writeDate = "later";
  i.snapshot!.saleLines[0].name = "New label";
  expect(projectDriverFinancials(i).totals?.net).toBe("10");
  for (const change of [
    (x: FinancialProjectionInput) => {
      x.snapshot!.saleLines[0].unitPrice = "11";
    },
    (x: FinancialProjectionInput) => {
      x.snapshot!.lines[0].quantity = "2.1";
    },
    (x: FinancialProjectionInput) => {
      x.snapshot!.saleLines[0].taxIds = [3];
    },
    (x: FinancialProjectionInput) => {
      x.snapshot!.currency.name = "USD";
    },
  ]) {
    const x = structuredClone(i);
    change(x);
    expect(projectDriverFinancials(x).issues).toContain(
      "INCIDENT_FINANCIAL_REVIEW_REQUIRED",
    );
  }
  expect(financialIncidentBasis(i.snapshot!, 999)).toBeNull();
  i.snapshot!.saleLines = [];
  expect(financialIncidentBasis(i.snapshot!, 100)).toBeNull();
});
it("reports pending, unavailable, review, canceled, errors, future timestamps and exact freshness boundary", () => {
  const i = input();
  for (const status of [
    "pending_validation",
    "needs_review",
    "cancelled",
  ] as const) {
    i.snapshot!.status = status;
    expect(projectDriverFinancials(i)).toMatchObject({
      status,
      lines: [],
      totals: null,
    });
  }
  i.snapshot = null;
  i.lastSuccessAt = null;
  expect(projectDriverFinancials(i)).toMatchObject({
    status: "unavailable",
    fresh: false,
    currency: null,
  });
  for (const age of [-1, 180000, 180001]) {
    const x = input();
    x.lastSuccessAt = new Date(x.now.getTime() - age);
    expect(projectDriverFinancials(x).fresh).toBe(age === 180000);
  }
  const x = input();
  x.lastError = "ODOO_UNAVAILABLE";
  expect(projectDriverFinancials(x).fresh).toBe(false);
});
it("conserves taxes, discounts and stable allocation across several stock moves", () => {
  const i = input(),
    s = i.snapshot!;
  s.saleLines[0].amounts = { untaxed: "0.02", tax: "0.01", total: "0.03" };
  s.saleLines[0].discount = "50";
  s.lines[0].quantity = "1";
  s.lines.push({ ...s.lines[0], id: 101 });
  i.imported.push({ ...i.imported[0], moveId: 101 });
  i.published.push({ ...i.published[0] });
  s.shipmentAmounts = { untaxed: "0.02", tax: "0.01", total: "0.03" };
  const result = projectDriverFinancials(i);
  expect(result.lines.map((line) => line.total)).toEqual(["0.02", "0.01"]);
  expect(
    result.lines.every((line) =>
      new D(line.untaxed).plus(line.tax).eq(line.total),
    ),
  ).toBe(true);
  expect(result.totals?.net).toBe("0.03");
  s.lines.reverse();
  expect(projectDriverFinancials(i)).toEqual(result);
});
it.each(["0.01", "-0.01"])(
  "preserves global adjustment %s in partial/full returns",
  (adjustment) => {
    const i = input(),
      s = i.snapshot!;
    s.roundingAdjustment = adjustment;
    s.shipmentAmounts!.total = new D("20").plus(adjustment).toFixed();
    i.incidents = [incident(i)];
    let result = projectDriverFinancials(i);
    expect(
      sumFinancial([
        result.totals!.net,
        result.totals!.deduction,
        result.totals!.deferred,
      ]).toFixed(),
    ).toBe(s.shipmentAmounts!.total);
    i.incidents[0].quantity = "2";
    result = projectDriverFinancials(i);
    expect(result.totals).toMatchObject({
      net: "0",
      deduction: s.shipmentAmounts!.total,
    });
  },
);
it("does not break the route when official amounts cannot be allocated", () => {
  const i = input();
  i.snapshot!.saleLines[0].amounts.untaxed = "0.001";
  expect(projectDriverFinancials(i)).toMatchObject({
    status: "needs_review",
    totals: null,
    issues: ["FINANCIAL_ALLOCATION_INVALID"],
  });
});
it("preserves legacy hashes and requires explicit replacement choice in the new contract", () => {
  expect(incidentFinancialInput({}, "return")).toEqual({});
  for (const raw of [
    { financial: {} },
    { replacementPayment: "pay_full" },
    { financialContractVersion: 2 },
    { financialContractVersion: 1, financial: [] },
    { financialContractVersion: 1, financial: null },
  ])
    expect(() => incidentFinancialInput(raw, "return")).toThrow(
      "INVALID_FINANCIAL_INCIDENT",
    );
  for (const choice of [null, undefined, "", "unknown"])
    expect(() =>
      incidentFinancialInput(
        { financialContractVersion: 1, replacementPayment: choice },
        "replacement_quality",
      ),
    ).toThrow("REPLACEMENT_PAYMENT_REQUIRED");
  for (const kind of ["replacement_quality", "replacement_wrong_product"])
    for (const replacementPayment of ["pay_full", "defer"])
      expect(
        incidentFinancialInput(
          { financialContractVersion: 1, replacementPayment },
          kind,
        ),
      ).toEqual({ financialContractVersion: 1, replacementPayment });
  expect(() =>
    incidentFinancialInput(
      { financialContractVersion: 1, replacementPayment: "defer" },
      "return",
    ),
  ).toThrow();
  const financial = { revision: 1, moveId: 100, saleLineId: 10 };
  expect(
    productIncidentInput({
      kind: "shortage_validation",
      financialContractVersion: 1,
      financial,
      lineIndex: 0,
      quantity: "1",
      department: "Operaciones",
    }),
  ).toMatchObject({ financial, lineIndex: 0, product: null, unit: null });
  for (const key of ["revision", "moveId", "saleLineId"])
    expect(() =>
      incidentFinancialInput(
        { financialContractVersion: 1, financial: { ...financial, [key]: 0 } },
        "return",
      ),
    ).toThrow("INVALID_FINANCIAL_INCIDENT");
});
