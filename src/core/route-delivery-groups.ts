import { AppError } from "./errors";
import type { Shipment } from "./orders-contract";

type GroupShipment = Pick<
  Shipment,
  "id" | "partnerId" | "fulfillmentMode" | "customerArchived"
>;

export function deliveryGroups(shipments: GroupShipment[]) {
  // One Odoo source is bound to the installation. partnerId is the shipping
  // contact, not the commercial parent: distinct destinations must stay distinct.
  const groups = new Map<number, { id: string; shipmentIds: string[] }>();
  for (const shipment of shipments) {
    if (shipment.fulfillmentMode !== "delivery" || shipment.customerArchived)
      continue;
    let group = groups.get(shipment.partnerId);
    if (!group) {
      group = { id: shipment.id, shipmentIds: [] };
      groups.set(shipment.partnerId, group);
    }
    group.shipmentIds.push(shipment.id);
  }
  return [...groups.values()];
}

export function assertDeliveryGroups(
  shipments: GroupShipment[],
  routes: { vehicleId: string; shipmentIds: string[] }[],
) {
  const positions = new Map(
    routes.flatMap((route) =>
      route.shipmentIds.map(
        (id, index) => [id, { vehicleId: route.vehicleId, index }] as const,
      ),
    ),
  );
  for (const group of deliveryGroups(shipments)) {
    const assigned = group.shipmentIds.flatMap((id) => {
      const position = positions.get(id);
      return position ? [position] : [];
    });
    // A wholly skipped group is supported by the persistence contract. The AI
    // candidate boundary separately requires exact coverage of every delivery.
    if (!assigned.length) continue;
    const indices = assigned.map((position) => position.index);
    if (
      assigned.length !== group.shipmentIds.length ||
      assigned.some(
        (position) => position.vehicleId !== assigned[0].vehicleId,
      ) ||
      Math.max(...indices) - Math.min(...indices) + 1 !== assigned.length
    )
      throw new AppError("ROUTING_CUSTOMER_GROUP_INVALID", 422);
  }
}
