import { expect, it } from "vitest";
import { routeStartPendingOrders } from "../src/core/route-start-validation";

it("requires every order to be validated, with IDs and folios preserved", () => {
  const orders = [
    { id: "a", orderName: "S1", fulfillmentStatus: "validated" as const },
    {
      id: "b",
      orderName: "S2",
      fulfillmentStatus: "pending_validation" as const,
    },
    {
      id: "c",
      orderName: "S3",
      fulfillmentStatus: "pending_validation" as const,
    },
  ];
  expect(routeStartPendingOrders(orders)).toEqual([
    { id: "b", orderName: "S2" },
    { id: "c", orderName: "S3" },
  ]);
  expect(
    routeStartPendingOrders(
      orders.map((order) => ({ ...order, fulfillmentStatus: "validated" })),
    ),
  ).toEqual([]);
  expect(orders[1].fulfillmentStatus).toBe("pending_validation");
});

it("does not authorize cancelled or unknown states, or invent missing orders", () => {
  expect(
    routeStartPendingOrders([
      { id: "x", orderName: "Cancelado", fulfillmentStatus: "cancelled" },
      { id: "y", orderName: "Sin estado" },
    ]),
  ).toEqual([
    { id: "x", orderName: "Cancelado" },
    { id: "y", orderName: "Sin estado" },
  ]);
  expect(routeStartPendingOrders([])).toEqual([]);
  expect(
    routeStartPendingOrders([
      { id: "z", orderName: "Nulo", fulfillmentStatus: null },
    ]),
  ).toEqual([{ id: "z", orderName: "Nulo" }]);
});
