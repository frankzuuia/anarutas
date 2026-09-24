import { isDeepStrictEqual } from "node:util";
import type { OrderBoard } from "./orders-contract";
import type { PublicOptimizedRoute } from "./routing-contract";

export function routePublicationSnapshot(
  board: OrderBoard,
  vehicle: OrderBoard["vehicles"][number],
  route: PublicOptimizedRoute | null,
  routingInputHash: string,
) {
  return {
    plan: {
      id: board.plan.id,
      label: board.plan.label,
      serviceDate: board.plan.service_date,
      version: board.plan.version,
    },
    vehicle: { id: vehicle.id, name: vehicle.name, plate: vehicle.plate },
    orders: board.shipments
      .filter((shipment) => shipment.vehicle_id === vehicle.id)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((shipment) => ({
        id: shipment.id,
        orderName: shipment.orderName,
        customerName: shipment.customerName,
        address: shipment.address,
        position: shipment.position,
        phone: shipment.phone,
        priority: shipment.priority,
        deliveryWindows: shipment.deliveryWindows,
        deliveryNote: shipment.deliveryNote,
        fulfillmentMode: shipment.fulfillmentMode,
        latitude: shipment.latitude,
        longitude: shipment.longitude,
        locationStatus: shipment.locationStatus,
        lines: shipment.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unit: line.unit,
          pickerNote: line.pickerNote ?? null,
        })),
      })),
    routeStatus: "current",
    route,
    routingInputHash,
  };
}

type Snapshot = Partial<ReturnType<typeof routePublicationSnapshot>>;

export function routePublicationContentChanged(previous: Snapshot, next: Snapshot) {
  const comparable = (value: Snapshot) => ({
    plan: value.plan
      ? { id: value.plan.id, label: value.plan.label, serviceDate: value.plan.serviceDate }
      : null,
    vehicle: value.vehicle,
    // Positions are global slots in the draft; only this vehicle's sequence matters.
    orders: value.orders?.map((order, index) => ({ ...order, position: index + 1 })),
    routeStatus: value.routeStatus,
    route: value.route,
  });
  // JSONB changes object key order; optional undefined fields are absent on the wire.
  return !isDeepStrictEqual(
    JSON.parse(JSON.stringify(comparable(previous))),
    JSON.parse(JSON.stringify(comparable(next))),
  ) || Boolean(previous.routingInputHash && previous.routingInputHash !== next.routingInputHash);
}
