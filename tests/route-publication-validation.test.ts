import { expect, it } from "vitest";
import { routePublicationPendingVehicles } from "../src/core/route-publication-validation";

it("blocks every non-validated member with its folio, never foreign or unassigned orders", () => {
  const vehicles = [
    { id: "a", name: "Camioneta A" },
    { id: "b", name: "Camioneta B" },
  ];
  const orders = [
    {
      id: "1",
      orderName: "S1",
      vehicle_id: "a",
      fulfillmentStatus: "validated",
    },
    {
      id: "2",
      orderName: "S2",
      vehicle_id: "a",
      fulfillmentStatus: "pending_validation",
    },
    { id: "3", orderName: "S3", vehicle_id: "a", fulfillmentStatus: null },
    { id: "4", orderName: "S4", vehicle_id: "a", fulfillmentStatus: "unknown" },
    {
      id: "5",
      orderName: "S5",
      vehicle_id: "b",
      fulfillmentStatus: "validated",
    },
    {
      id: "6",
      orderName: "S6",
      vehicle_id: null,
      fulfillmentStatus: "pending_validation",
    },
    {
      id: "7",
      orderName: "S7",
      vehicle_id: "foreign",
      fulfillmentStatus: "pending_validation",
    },
  ];
  const before = structuredClone(orders);
  expect(routePublicationPendingVehicles(vehicles, orders)).toEqual([
    {
      vehicleId: "a",
      vehicleName: "Camioneta A",
      pendingValidationOrders: [
        { id: "2", orderName: "S2" },
        { id: "3", orderName: "S3" },
        { id: "4", orderName: "S4" },
      ],
    },
  ]);
  expect(routePublicationPendingVehicles([vehicles[1]], orders)).toEqual([]);
  expect(routePublicationPendingVehicles([], orders)).toEqual([]);
  expect(routePublicationPendingVehicles(vehicles, [])).toEqual([]);
  expect(orders).toEqual(before);
});
