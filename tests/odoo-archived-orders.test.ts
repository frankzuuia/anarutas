import { expect, it } from "vitest";
import { partitionArchivedOrders } from "../src/core/odoo-archived-orders";
import { localShipment } from "./helpers/candidate";

it("isolates only the exact archived delivery contact despite identical customer names", () => {
  const active = localShipment(1),
    archived = localShipment(2);
  const before = structuredClone([active, archived]);
  const result = partitionArchivedOrders([
    { ...active, odooPartnerActive: true },
    { ...archived, odooPartnerActive: false },
  ]);
  expect(result.shipments).toEqual([active]);
  expect(result.archivedCustomerOrders).toEqual([
    {
      pickingId: archived.pickingId,
      pickingName: archived.pickingName,
      orderId: archived.orderId,
      orderName: archived.orderName,
      partnerId: archived.partnerId,
      customerName: archived.customerName,
    },
  ]);
  expect([active, archived]).toEqual(before);
  expect(result.shipments[0]).not.toHaveProperty("odooPartnerActive");
});

it.each(["done", "confirmed", "assigned"])(
  "preserves eligible %s shipments and their complete payload",
  (state) => {
    const shipment = { ...localShipment(), odooPickingState: state };
    const result = partitionArchivedOrders([
      { ...shipment, odooPartnerActive: true },
    ]);
    expect(result).toEqual({
      shipments: [shipment],
      archivedCustomerOrders: [],
    });
  },
);

it("returns an informative empty selection when all delivery contacts are archived", () => {
  const result = partitionArchivedOrders(
    [1, 2].map((id) => ({ ...localShipment(id), odooPartnerActive: false })),
  );
  expect(result.shipments).toEqual([]);
  expect(result.archivedCustomerOrders.map((s) => s.partnerId)).toEqual([1, 2]);
  expect(partitionArchivedOrders([])).toEqual({
    shipments: [],
    archivedCustomerOrders: [],
  });
});

it.each([undefined, null, 0, 1, "false", "true", {}, []])(
  "does not label an unknown/invalid archive state as archived or eligible: %j",
  (active) => {
    expect(() =>
      partitionArchivedOrders([
        { ...localShipment(), odooPartnerActive: active },
      ]),
    ).toThrow("ODOO_INVALID_RESPONSE");
  },
);
