import { describe, expect, it } from "vitest";
import {
  assertDeliveryGroups,
  deliveryGroups,
} from "../src/core/route-delivery-groups";

const shipment = (id: string, partnerId: number) => ({
  id,
  partnerId,
  fulfillmentMode: "delivery" as const,
  customerArchived: false,
});
const deliveries = [
  shipment("a1", 10),
  shipment("b", 20),
  shipment("a2", 10),
  shipment("a3", 10),
];
const routes = (first: string[], second: string[] = []) => [
  { vehicleId: "v1", shipmentIds: first },
  { vehicleId: "v2", shipmentIds: second },
];

describe("indivisible delivery customer groups / pure domain, no provider substitutes", () => {
  it("retains every order and separates distinct shipping identities", () => {
    expect(deliveryGroups(deliveries)).toEqual([
      { id: "a1", shipmentIds: ["a1", "a2", "a3"] },
      { id: "b", shipmentIds: ["b"] },
    ]);
    expect(deliveryGroups([])).toEqual([]);
  });
  it("excludes pickup and archived customers independently", () => {
    expect(
      deliveryGroups([
        ...deliveries,
        { ...shipment("pickup", 10), fulfillmentMode: "pickup" },
        { ...shipment("archived", 10), customerArchived: true },
      ]),
    ).toEqual(deliveryGroups(deliveries));
  });
  it.each([
    routes(["a1", "a2", "a3"], ["b"]),
    routes(["b", "a3", "a1", "a2"]),
    routes([], ["a2", "a1", "a3", "b"]),
    routes(["b"]),
    routes([]),
  ])(
    "accepts complete contiguous groups, independent of input order: %j",
    (...candidate) => {
      expect(() => assertDeliveryGroups(deliveries, candidate)).not.toThrow();
    },
  );
  it.each([
    routes(["a1", "b"], ["a2", "a3"]),
    routes(["a1"], ["b", "a2", "a3"]),
    routes(["a1", "a2", "b", "a3"]),
    routes(["a1", "b", "a2", "a3"]),
    routes(["a1", "a2", "b"]),
  ])(
    "rejects splitting, interleaving and partial assignment: %j",
    (...candidate) => {
      expect(() => assertDeliveryGroups(deliveries, candidate)).toThrow(
        "ROUTING_CUSTOMER_GROUP_INVALID",
      );
    },
  );
});
