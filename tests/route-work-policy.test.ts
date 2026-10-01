import { expect, it } from "vitest";
import {
  routeSettlementReview,
  routeWorkReview,
  routeWorkSummary,
  type WorkReceipt,
} from "../src/core/route-work-policy";
const receipt = (patch: Partial<WorkReceipt> = {}): WorkReceipt => ({
  id: "p1",
  shipmentId: "s1",
  currency: { id: 1, name: "MXN", decimalPlaces: 2, rounding: "0.01" },
  expected: "83.21",
  received: "83.21",
  tendered: "83.21",
  change: "0",
  balance: "0",
  deferred: "0",
  method: "cash",
  snapshot: { incidents: [{ id: "return1", status: "pending" }] },
  ...patch,
});
const orders = [{ shipmentId: "s1", status: "delivered" }];
it("reserves only the remaining route receipts and keeps already accepted totals out of the preview", () => {
  const payments = [
    receipt(),
    receipt({
      id: "p2",
      shipmentId: "s2",
      method: "mixed",
      received: "20",
      expected: "20",
      cashReceived: "7",
      transferReceived: "13",
    }),
  ];
  const allOrders = [...orders, { shipmentId: "s2", status: "delivered" }];
  const initial = routeSettlementReview("e1", true, allOrders, payments, []);
  const preview = routeSettlementReview("e1", true, allOrders, payments, [
    { status: "accepted", paymentIds: ["p1"] },
  ]);
  expect(preview).toMatchObject({
    eligible: true,
    reason: null,
    paymentIds: ["p2"],
  });
  expect(preview.totals[0]).toMatchObject({
    cash: "7",
    transfer: "13",
    credit: "0",
  });
  expect(preview.basis).not.toBe(initial.basis);
  const rejected = routeSettlementReview("e1", true, allOrders, payments, [
    { status: "rejected", paymentIds: ["p1"] },
  ]);
  expect(rejected.basis).toBe(initial.basis);
  expect(rejected.eligible).toBe(true);
  expect(
    routeSettlementReview("e1", true, allOrders, [...payments].reverse(), [])
      .paymentIds,
  ).toEqual(initial.paymentIds);
});
it.each([
  [false, orders, [receipt()], [], "SETTLEMENT_ROUTE_NOT_FINISHED"],
  [true, orders, [], [], "SETTLEMENT_PAYMENTS_MISSING"],
  [
    true,
    orders,
    [receipt()],
    [{ status: "pending", paymentIds: ["p1"] }],
    "SETTLEMENT_REQUEST_PENDING",
  ],
  [
    true,
    orders,
    [receipt()],
    [{ status: "accepted", paymentIds: ["p1"] }],
    "SETTLEMENT_NOTHING_PENDING",
  ],
  [
    true,
    [{ shipmentId: "s1", status: "rescheduled" }],
    [],
    [],
    "SETTLEMENT_NOTHING_PENDING",
  ],
] as const)(
  "reports the real route reservation obstruction %#",
  (completed, routeOrders, payments, requests, reason) => {
    expect(
      routeSettlementReview(
        "e1",
        completed,
        [...routeOrders],
        [...payments],
        requests.map((r) => ({ ...r, paymentIds: [...r.paymentIds] })),
      ),
    ).toMatchObject({ eligible: false, reason });
  },
);
it("counts frozen active incidents once and sums route value rather than outstanding cash, without combining currencies", () => {
  const payments = [
    receipt(),
    receipt({
      id: "p2",
      shipmentId: "s2",
      expected: "9007199254740993.01",
      received: "0",
      method: "credit",
      balance: "9007199254740993.01",
      snapshot: {
        incidents: [
          { id: "return1", status: "resolved" },
          { id: "canceled", status: "canceled" },
        ],
      },
    }),
    receipt({
      id: "p3",
      shipmentId: "s3",
      currency: { id: 2, name: "USD", decimalPlaces: 2, rounding: "0.01" },
      expected: "0.000001",
      snapshot: { incidents: [] },
    }),
  ];
  const summary = routeWorkSummary(
    [
      ...orders,
      { shipmentId: "s2", status: "delivered" },
      { shipmentId: "s3", status: "delivered" },
      { shipmentId: "s4", status: "rescheduled" },
    ],
    payments,
  );
  expect(summary).toMatchObject({
    contractVersion: 1,
    deliveredOrders: 3,
    incidents: 1,
    paymentIds: ["p1", "p2", "p3"],
  });
  expect(
    summary.totals.map((total) => [total.currency.name, total.total]),
  ).toEqual([
    ["MXN", "9007199254741076.22"],
    ["USD", "0.000001"],
  ]);
  expect(payments[0].expected).toBe("83.21");
  expect(routeWorkSummary([], [])).toMatchObject({
    deliveredOrders: 0,
    incidents: 0,
    paymentIds: [],
    totals: [],
  });
});
it.each([
  [
    false,
    orders,
    [receipt()],
    [{ status: "accepted", paymentIds: ["p1"] }],
    "SETTLEMENT_ROUTE_NOT_FINISHED",
  ],
  [true, orders, [], [], "SETTLEMENT_PAYMENTS_MISSING"],
  [true, [], [], [], "WORK_SETTLEMENT_PENDING"],
  [true, orders, [receipt()], [], "WORK_SETTLEMENT_PENDING"],
  [
    true,
    orders,
    [receipt()],
    [{ status: "pending", paymentIds: ["p1"] }],
    "WORK_SETTLEMENT_PENDING",
  ],
  [
    true,
    orders,
    [receipt()],
    [{ status: "rejected", paymentIds: ["p1"] }],
    "WORK_SETTLEMENT_PENDING",
  ],
] as const)(
  "cannot close work before every receipt is accepted %#",
  (completed, routeOrders, payments, requests, reason) => {
    expect(
      routeWorkReview(
        "e1",
        completed,
        [...routeOrders],
        [...payments],
        requests.map((r) => ({ ...r, paymentIds: [...r.paymentIds] })),
      ),
    ).toMatchObject({ eligible: false, reason });
  },
);
it("permits finalization after individual or route acceptance and binds the exact reviewed work summary", () => {
  const accepted = [{ status: "accepted", paymentIds: ["p1"] }];
  const reviewed = routeWorkReview("e1", true, orders, [receipt()], accepted);
  expect(reviewed).toMatchObject({
    eligible: true,
    reason: null,
    summary: { deliveredOrders: 1, incidents: 1 },
  });
  expect(
    routeWorkReview("e2", true, orders, [receipt()], accepted).basis,
  ).not.toBe(reviewed.basis);
  expect(
    routeWorkReview(
      "e1",
      true,
      orders,
      [receipt({ expected: "83.20" })],
      accepted,
    ).basis,
  ).not.toBe(reviewed.basis);
});

it("keeps work blocked when only some receipts have been accepted", () => {
  const payments = [receipt(), receipt({ id: "p2", shipmentId: "s2" })];
  expect(
    routeWorkReview(
      "e1",
      true,
      [...orders, { shipmentId: "s2", status: "delivered" }],
      payments,
      [{ status: "accepted", paymentIds: ["p1"] }],
    ),
  ).toMatchObject({ eligible: false, reason: "WORK_SETTLEMENT_PENDING" });
});

it("keeps receipt ordering stable and counts distinct active incidents across returned products", () => {
  const first = receipt({
    snapshot: {
      incidents: [
        { id: "return1", status: "pending" },
        { id: "return2", status: "resolved" },
        { id: "canceled", status: "canceled" },
      ],
    },
  });
  const second = receipt({ id: "p2", shipmentId: "s2" });
  expect(routeWorkSummary(orders, [second, first])).toMatchObject({
    incidents: 2,
    paymentIds: ["p1", "p2"],
  });
});
