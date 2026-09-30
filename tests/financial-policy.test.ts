import { expect, it } from "vitest";
import {
  buildFinancialSnapshot,
  assertFinancialCoherence,
  financialHash,
} from "../src/core/financial-policy";
import {
  financialDecimal,
  roundFinancial,
  sumFinancial,
} from "../src/core/financial-values";
import {
  financialSyncConfig,
  financialRetrySeconds,
} from "../src/core/financial-config";
import { financialError } from "../src/core/financial-sync";
import { AppError } from "../src/core/errors";
import { odooRetryAfter } from "../src/core/odoo-retry";
import { financialObservation, financialTarget } from "./helpers/financial";
import type {
  FinancialObservation,
  FinancialReason,
} from "../src/core/financial-contract";

it("ready stores exact source values and stable identity; pending and cancelled never acquire shipment money", () => {
  const observation = financialObservation();
  const ready = buildFinancialSnapshot(financialTarget, observation);
  expect(ready).toEqual({
    contractVersion: 1,
    target: financialTarget,
    companyId: 1,
    status: "ready",
    reasons: [],
    currency: observation.currency,
    picking: observation.picking,
    order: observation.order,
    saleLines: observation.saleLines,
    lines: observation.moves,
    shipmentAmounts: observation.order.amounts,
    roundingAdjustment: "0",
    observation,
  });
  for (const state of ["assigned", "confirmed", "waiting", "draft"]) {
    observation.picking.state = state;
    observation.picking.validatedAt = null;
    observation.moves[0].quantity = "0";
    observation.saleLines[0].delivered = "0";
    expect(buildFinancialSnapshot(financialTarget, observation)).toMatchObject({
      status: "pending_validation",
      shipmentAmounts: null,
    });
  }
  observation.picking.state = "cancel";
  expect(buildFinancialSnapshot(financialTarget, observation).status).toBe(
    "cancelled",
  );
  observation.picking.state = "done";
  observation.order.state = "cancel";
  expect(buildFinancialSnapshot(financialTarget, observation).status).toBe(
    "cancelled",
  );
  observation.order.state = "sale";
  observation.moves[0].quantity = "2";
  observation.saleLines[0].delivered = "2";
  expect(buildFinancialSnapshot(financialTarget, observation).status).toBe(
    "pending_validation",
  );
});

const cases: [FinancialReason, (observation: FinancialObservation) => void][] =
  [
    [
      "MOVE_NOT_VALIDATED",
      (o) => {
        o.moves[0].state = "assigned";
      },
    ],
    [
      "ORDER_NOT_CONFIRMED",
      (o) => {
        o.order.state = "draft";
      },
    ],
    [
      "NOT_CUSTOMER_DELIVERY",
      (o) => {
        o.picking.outgoing = false;
      },
    ],
    [
      "NOT_CUSTOMER_DELIVERY",
      (o) => {
        o.picking.customerDestination = false;
      },
    ],
    [
      "NO_DELIVERY_LINES",
      (o) => {
        o.moves = [];
      },
    ],
    [
      "UNLINKED_MOVE",
      (o) => {
        o.moves[0].saleLineId = null;
      },
    ],
    [
      "SALE_LINE_NOT_DELIVERED",
      (o) => {
        o.moves[0].saleLineId = 99;
      },
    ],
    [
      "UOM_MISMATCH",
      (o) => {
        o.moves[0].uomId = 90;
      },
    ],
    [
      "PRODUCT_MISMATCH",
      (o) => {
        o.moves[0].productId = 90;
      },
    ],
    [
      "CURRENCY_MISMATCH",
      (o) => {
        o.saleLines[0].currencyId = 90;
      },
    ],
    [
      "QUANTITY_MISMATCH",
      (o) => {
        o.moves[0].quantity = "1.99";
      },
    ],
    [
      "QUANTITY_MISMATCH",
      (o) => {
        o.saleLines[0].delivered = "1.99";
      },
    ],
    [
      "UNSUPPORTED_SIGN",
      (o) => {
        o.saleLines[0].quantity = "0";
      },
    ],
    [
      "UNSUPPORTED_SIGN",
      (o) => {
        o.saleLines[0].unitPrice = "-1";
      },
    ],
    [
      "UNSUPPORTED_SIGN",
      (o) => {
        o.saleLines[0].discount = "-1";
      },
    ],
    [
      "UNSUPPORTED_SIGN",
      (o) => {
        o.saleLines[0].discount = "101";
      },
    ],
    [
      "UNSUPPORTED_SIGN",
      (o) => {
        o.moves[0].quantity = "-1";
      },
    ],
    [
      "UNSUPPORTED_SIGN",
      (o) => {
        o.saleLines[0].amounts.total = "-1";
      },
    ],
    [
      "RETURNED_STOCK",
      (o) => {
        o.moves[0].returnedMoveId = 45;
      },
    ],
    [
      "AMOUNT_MISMATCH",
      (o) => {
        o.order.amounts.total = "20.01";
      },
    ],
    [
      "AMOUNT_MISMATCH",
      (o) => {
        o.order.amounts = { untaxed: "20.01", tax: "0", total: "20.01" };
      },
    ],
  ];
it.each(cases)("blocks %s without estimating money", (reason, change) => {
  const observation = financialObservation();
  change(observation);
  expect(buildFinancialSnapshot(financialTarget, observation)).toMatchObject({
    status: "needs_review",
    reasons: expect.arrayContaining([reason]),
    shipmentAmounts: null,
  });
});
it.each(["pickingId", "orderId", "partnerId"] as const)(
  "rejects changed identity %s",
  (key) => {
    expect(() =>
      buildFinancialSnapshot(
        { ...financialTarget, [key]: 98 },
        financialObservation(),
      ),
    ).toThrow("FINANCIAL_IDENTITY_CHANGED");
  },
);
it("aggregates multiple moves on one picking but never duplicates an order total across backorders", () => {
  const observation = financialObservation();
  observation.moves[0].quantity = "1";
  observation.moves.push({ ...observation.moves[0], id: 101 });
  expect(buildFinancialSnapshot(financialTarget, observation).status).toBe(
    "ready",
  );
  observation.relatedPickings.push({ ...observation.picking, id: 2 });
  observation.moves[1].pickingId = 2;
  expect(
    buildFinancialSnapshot(financialTarget, observation).reasons,
  ).toContain("SPLIT_DELIVERY");
  observation.moves[1].state = "cancel";
  observation.moves[0].quantity = "2";
  expect(buildFinancialSnapshot(financialTarget, observation).status).toBe(
    "ready",
  );
  observation.moves[1].state = "done";
  observation.relatedPickings[1].outgoing = false;
  expect(
    buildFinancialSnapshot(financialTarget, observation).reasons,
  ).not.toContain("SPLIT_DELIVERY");
  observation.relatedPickings[1].outgoing = true;
  observation.relatedPickings[1].customerDestination = false;
  expect(
    buildFinancialSnapshot(financialTarget, observation).reasons,
  ).not.toContain("SPLIT_DELIVERY");
  observation.relatedPickings[1].customerDestination = true;
  observation.moves[1].demand = "0";
  expect(
    buildFinancialSnapshot(financialTarget, observation).reasons,
  ).not.toContain("SPLIT_DELIVERY");
  observation.moves[1].pickingId = null;
  expect(
    buildFinancialSnapshot(financialTarget, observation).reasons,
  ).not.toContain("SPLIT_DELIVERY");
});
it("demonstrates positive/negative global rounding exactly, including discounts; unexplained cents block", () => {
  for (const [price, expected, adjustment] of [
    ["1.004", "2.01", "0.01"],
    ["1.005", "2.01", "-0.01"],
  ]) {
    const o = financialObservation();
    o.saleLines[0].quantity = "1";
    o.saleLines[0].delivered = "1";
    o.saleLines[0].unitPrice = price;
    const rounded = roundFinancial(price, "0.01").toFixed();
    o.saleLines[0].amounts = { untaxed: rounded, tax: "0", total: rounded };
    o.saleLines.push({ ...structuredClone(o.saleLines[0]), id: 11 });
    o.moves[0].quantity = "1";
    o.moves[0].demand = "1";
    o.moves.push({ ...o.moves[0], id: 101, saleLineId: 11 });
    o.order.amounts = { untaxed: expected, tax: "0", total: expected };
    expect(buildFinancialSnapshot(financialTarget, o)).toMatchObject({
      status: "ready",
      roundingAdjustment: adjustment,
    });
    o.saleLines.reverse();
    o.moves.reverse();
    expect(buildFinancialSnapshot(financialTarget, o).status).toBe("ready");
    o.saleLines[0].discount = "50";
    expect(buildFinancialSnapshot(financialTarget, o).status).toBe(
      "needs_review",
    );
  }
});
it("preserves Odoo tax/discount amounts without locally inventing tax rules", () => {
  const o = financialObservation();
  o.saleLines[0].discount = "10";
  o.saleLines[0].taxIds = [1];
  o.saleLines[0].amounts = { untaxed: "18", tax: "2.88", total: "20.88" };
  o.order.amounts = { ...o.saleLines[0].amounts };
  expect(buildFinancialSnapshot(financialTarget, o).status).toBe("ready");
  o.order.amounts = { untaxed: "18.01", tax: "2.88", total: "20.89" };
  expect(
    buildFinancialSnapshot(financialTarget, o).roundingAdjustment,
  ).toBeNull();
  o.saleLines[0].taxIds = [];
  expect(
    buildFinancialSnapshot(financialTarget, o).roundingAdjustment,
  ).toBeNull();
  o.saleLines[0].amounts = { untaxed: "20", tax: "0", total: "20" };
  expect(
    buildFinancialSnapshot(financialTarget, o).roundingAdjustment,
  ).toBeNull();
  o.order.amounts = { untaxed: "20", tax: "0", total: "20" };
  o.saleLines.push({ ...o.saleLines[0], id: 12, displayType: "line_note" });
  expect(buildFinancialSnapshot(financialTarget, o).status).toBe("ready");
});
it("compares canonical full observations; amount changes in the same timestamp must reject", () => {
  expect(financialHash({ a: 1, b: [2, null] })).toBe(
    financialHash({ b: [2, null], a: 1 }),
  );
  expect(financialHash([1, 2])).not.toBe(financialHash([2, 1]));
  const o = financialObservation();
  const second = structuredClone(o);
  expect(() => assertFinancialCoherence(o, second)).not.toThrow();
  second.saleLines[0].unitPrice = "11";
  expect(() => assertFinancialCoherence(o, second)).toThrow(
    "ODOO_FINANCIAL_CHANGED_DURING_READ",
  );
});
it.each([
  null,
  undefined,
  true,
  {},
  [],
  NaN,
  Infinity,
  "",
  " ",
  "x",
  "1e25",
  "1e-25",
  "1".repeat(81),
  "1.123456789012345678901234567890123",
])("rejects invalid decimal %s", (value) => {
  expect(() => financialDecimal(value)).toThrow("FINANCIAL_DECIMAL_INVALID");
});
it("exact decimals avoid floating point arithmetic and obey the configured currency increment", () => {
  expect(financialDecimal(1.07)).toBe("1.07");
  expect(financialDecimal("1.0700")).toBe("1.07");
  expect(financialDecimal(0)).toBe("0");
  expect(financialDecimal("-1e2")).toBe("-100");
  expect(sumFinancial(["0.1", "0.2"]).toFixed()).toBe("0.3");
  expect(roundFinancial("1.025", "0.05").toFixed()).toBe("1.05");
  expect(roundFinancial("-1.025", "0.05").toFixed()).toBe("-1.05");
  for (const step of ["0", "-1", "Infinity"])
    expect(() => roundFinancial(1, step)).toThrow("FINANCIAL_CURRENCY_INVALID");
});
it("runtime controls validate values and backoff honors Retry-After beyond the normal ceiling", () => {
  const config = financialSyncConfig({});
  expect(config).toEqual({
    pollSeconds: 60,
    freshSeconds: 180,
    batchSize: 20,
    retrySeconds: 60,
    maxRetrySeconds: 3600,
    metadataTtlSeconds: 900,
  });
  expect(financialRetrySeconds(0, config)).toBe(60);
  expect(financialRetrySeconds(2, config)).toBe(240);
  expect(financialRetrySeconds(50, config)).toBe(3600);
  expect(financialRetrySeconds(50, config, 7200)).toBe(7200);
  for (const value of ["0", "-1", "0.5", "NaN", "86401"])
    expect(() =>
      financialSyncConfig({ RUTAS_FINANCIAL_POLL_SECONDS: value }),
    ).toThrow("FINANCIAL_CONFIG_INVALID");
  expect(
    financialSyncConfig({
      RUTAS_FINANCIAL_BATCH_SIZE: "5",
      RUTAS_FINANCIAL_POLL_SECONDS: " ",
    }).batchSize,
  ).toBe(5);
  expect(odooRetryAfter("120")).toBe(120);
  expect(odooRetryAfter("0.5")).toBe(1);
  expect(
    odooRetryAfter(
      "Wed, 30 Sep 2026 14:02:00 GMT",
      Date.parse("2026-09-30T14:00:00Z"),
    ),
  ).toBe(120);
  expect(
    odooRetryAfter(
      "Wed, 30 Sep 2026 14:02:00 GMT",
      Date.parse("2026-09-30T15:00:00Z"),
    ),
  ).toBe(0);
  expect(odooRetryAfter(null)).toBeUndefined();
  expect(odooRetryAfter(" ")).toBeUndefined();
  expect(odooRetryAfter("garbage")).toBeUndefined();
  expect(odooRetryAfter("-1")).toBeUndefined();
  expect(odooRetryAfter("2147483648")).toBeUndefined();
  expect(financialError(new Error("secret"))).toBe(
    "FINANCIAL_SYNC_UNAVAILABLE",
  );
  expect(financialError(new AppError("ODOO_DENIED", 502))).toBe("ODOO_DENIED");
});

it("checks inclusive config, decimal and Retry-After boundaries without binary rounding", () => {
  expect(
    financialSyncConfig({
      RUTAS_FINANCIAL_POLL_SECONDS: "1",
      RUTAS_FINANCIAL_RETRY_SECONDS: "5",
      RUTAS_FINANCIAL_MAX_RETRY_SECONDS: "600",
      RUTAS_FINANCIAL_METADATA_TTL_SECONDS: "700",
    }),
  ).toEqual({
    pollSeconds: 1,
    freshSeconds: 3,
    retrySeconds: 5,
    maxRetrySeconds: 600,
    metadataTtlSeconds: 700,
    batchSize: 20,
  });
  expect(
    financialSyncConfig({ RUTAS_FINANCIAL_POLL_SECONDS: "86400" }).pollSeconds,
  ).toBe(86400);
  expect(financialDecimal("1." + "0".repeat(78))).toBe("1");
  expect(() => financialDecimal("1." + "0".repeat(79))).toThrow(
    "FINANCIAL_DECIMAL_INVALID",
  );
  expect(financialDecimal("1e24")).toBe("1" + "0".repeat(24));
  expect(financialDecimal("1e-24")).toBe("0." + "0".repeat(23) + "1");
  expect(financialDecimal("1.1234567890123456789012345678901")).toBe(
    "1.1234567890123456789012345678901",
  );
  expect(() => financialDecimal(1n)).toThrow("FINANCIAL_DECIMAL_INVALID");
  expect(sumFinancial(["1000000000000000000000000", "0.01"]).toFixed()).toBe(
    "1000000000000000000000000.01",
  );
  expect(odooRetryAfter("0")).toBe(0);
  expect(odooRetryAfter("2147483647")).toBe(2147483647);
  const now = Date.parse("2026-01-01T00:00:00Z");
  expect(
    odooRetryAfter(new Date(now + 2147483647 * 1000).toUTCString(), now),
  ).toBe(2147483647);
  expect(
    odooRetryAfter(new Date(now + 2147483648 * 1000).toUTCString(), now),
  ).toBeUndefined();
  expect(financialHash([1, 2])).not.toBe(financialHash({ "0": 1, "1": 2 }));
});
it("does not accept balanced totals whose own tax/subtotal equation is wrong", () => {
  const o = financialObservation();
  o.saleLines[0].amounts.tax = "1";
  o.order.amounts.tax = "1";
  expect(buildFinancialSnapshot(financialTarget, o)).toMatchObject({
    status: "needs_review",
    roundingAdjustment: null,
  });
  o.saleLines[0].amounts = { untaxed: "19.999", tax: "0.001", total: "20" };
  o.order.amounts = { untaxed: "20", tax: "0", total: "20" };
  expect(
    buildFinancialSnapshot(financialTarget, o).roundingAdjustment,
  ).toBeNull();
});
it("rejects a tax-bearing rounding discrepancy and a single corrupted line even if global arithmetic agrees", () => {
  const o = financialObservation();
  o.saleLines[0].quantity = "1";
  o.saleLines[0].delivered = "1";
  o.saleLines[0].unitPrice = "1.004";
  o.saleLines[0].amounts = { untaxed: "1", tax: "0", total: "1" };
  o.saleLines.push({ ...structuredClone(o.saleLines[0]), id: 11 });
  o.moves[0].quantity = "1";
  o.moves[0].demand = "1";
  o.moves.push({ ...o.moves[0], id: 101, saleLineId: 11 });
  o.order.amounts = { untaxed: "2.01", tax: "0", total: "2.01" };
  o.saleLines[0].taxIds = [1];
  expect(
    buildFinancialSnapshot(financialTarget, o).roundingAdjustment,
  ).toBeNull();
  o.saleLines[0].taxIds = [];
  o.saleLines[0].amounts = { untaxed: "0.999", tax: "0.001", total: "1" };
  expect(
    buildFinancialSnapshot(financialTarget, o).roundingAdjustment,
  ).toBeNull();
  o.saleLines[0].amounts = { untaxed: "0.99", tax: "0", total: "0.99" };
  expect(
    buildFinancialSnapshot(financialTarget, o).roundingAdjustment,
  ).toBeNull();
});
it("filters canceled/other-order moves and detects one invalid move among valid siblings", () => {
  const o = financialObservation();
  o.order.state = "done";
  o.moves.push({ ...o.moves[0], id: 101, state: "cancel" });
  expect(buildFinancialSnapshot(financialTarget, o)).toMatchObject({
    status: "ready",
    lines: [o.moves[0]],
  });
  o.moves[1].state = "done";
  o.moves[1].saleLineId = 99;
  expect(buildFinancialSnapshot(financialTarget, o)).toMatchObject({
    status: "ready",
    lines: [o.moves[0]],
  });
  o.moves[1].saleLineId = null;
  expect(buildFinancialSnapshot(financialTarget, o).reasons).toContain(
    "UNLINKED_MOVE",
  );
  o.moves[1].saleLineId = 10;
  o.moves[1].uomId = 7;
  o.moves[1].productId = 8;
  o.moves[1].quantity = "-1";
  const snapshot = buildFinancialSnapshot(financialTarget, o);
  expect(snapshot.reasons).toEqual([
    "PRODUCT_MISMATCH",
    "QUANTITY_MISMATCH",
    "UNSUPPORTED_SIGN",
    "UOM_MISMATCH",
  ]);
  o.picking.state = "assigned";
  expect(
    buildFinancialSnapshot(financialTarget, {
      ...financialObservation(),
      picking: { ...o.picking, validatedAt: o.picking.validatedAt },
    }).status,
  ).toBe("pending_validation");
});

it("distinguishes shipment scope and validates every final move", () => {
  const o = financialObservation();
  o.moves.push({ ...o.moves[0], id: 101, pickingId: 2 });
  o.relatedPickings.push({ ...o.picking, id: 2, outgoing: false });
  expect(buildFinancialSnapshot(financialTarget, o)).toMatchObject({
    status: "ready",
    lines: [o.moves[0]],
  });
  o.moves[1].pickingId = 1;
  o.moves[1].quantity = "1";
  o.moves[0].quantity = "1";
  o.moves[1].state = "assigned";
  expect(buildFinancialSnapshot(financialTarget, o).reasons).toContain(
    "MOVE_NOT_VALIDATED",
  );
  o.picking.state = "assigned";
  o.moves[0].state = "assigned";
  o.moves[0].demand = "1";
  o.moves[1].demand = "1";
  o.picking.validatedAt = null;
  expect(buildFinancialSnapshot(financialTarget, o).status).toBe(
    "pending_validation",
  );
});
it("a matching total alone does not bypass a mismatched taxed subtotal", () => {
  const o = financialObservation();
  o.saleLines[0].amounts.untaxed = "20.004";
  o.saleLines[0].taxIds = [1];
  expect(buildFinancialSnapshot(financialTarget, o)).toMatchObject({
    status: "needs_review",
    roundingAdjustment: null,
  });
});
