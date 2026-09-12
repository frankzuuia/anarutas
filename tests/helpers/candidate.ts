import type { RoutingShipment } from "../../src/core/order-candidates-contract";
/** Local domain input, never served as an Odoo response. */
export function localShipment(id = 1): RoutingShipment {
  return {
    pickingId: id,
    pickingName: `QA/${id}`,
    orderId: id,
    orderName: `QA-${id}`,
    partnerId: id,
    customerName: "Cliente de prueba local",
    address: "Dirección local",
    validatedAt: null,
    odooPickingState: "assigned",
    fulfillmentStatus: "pending_validation",
    scheduledAt: "2026-09-11T21:40:34.000Z",
    sourceUpdatedAt: "2026-09-11T21:40:34.000Z",
    promisedAt: null,
    backorderId: null,
    lines: [
      {
        moveId: id,
        productId: id,
        name: "Partida prueba local",
        quantity: 2,
        unit: "kg",
      },
    ],
  };
}
