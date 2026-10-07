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
        unloadingMinutes: shipment.unloadingMinutes ?? null,
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

type Publication = ReturnType<typeof routePublicationSnapshot>;
type Snapshot = Omit<Partial<Publication>, "orders"> & {
  orders?: (Omit<Publication["orders"][number], "unloadingMinutes"> & { unloadingMinutes?: number | null })[];
};

/** Before first start, source products must still match the frozen publication. */
export function routePublicationSourceChanged(
  previous: Snapshot,
  shipments: Pick<
    OrderBoard["shipments"][number],
    "id" | "lines" | "fulfillmentStatus"
  >[],
) {
  if (!previous.orders || previous.orders.length !== shipments.length)
    return true;
  const current = new Map(shipments.map((shipment) => [shipment.id, shipment]));
  return previous.orders.some((order) => {
    const shipment = current.get(order.id);
    if (
      !shipment ||
      shipment.fulfillmentStatus === "cancelled" ||
      !shipment.lines.length
    )
      return true;
    const lines = shipment.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unit: line.unit,
      pickerNote: line.pickerNote ?? null,
    }));
    return !isDeepStrictEqual(
      order.lines.map((line) => ({
        ...line,
        pickerNote: line.pickerNote ?? null,
      })),
      lines,
    );
  });
}

export function routePublicationContentChanged(
  previous: Snapshot,
  next: Snapshot,
) {
  const comparable = (value: Snapshot) => ({
    plan: value.plan
      ? {
          id: value.plan.id,
          label: value.plan.label,
          serviceDate: value.plan.serviceDate,
        }
      : null,
    vehicle: value.vehicle,
    // Positions are global slots in the draft; only this vehicle's sequence matters.
    orders: value.orders?.map((order, index) => ({
      ...order,
      unloadingMinutes: order.unloadingMinutes ?? null,
      position: index + 1,
    })),
    routeStatus: value.routeStatus,
    route: value.route,
  });
  // JSONB changes object key order; optional undefined fields are absent on the wire.
  return (
    !isDeepStrictEqual(
      JSON.parse(JSON.stringify(comparable(previous))),
      JSON.parse(JSON.stringify(comparable(next))),
    ) ||
    Boolean(
      previous.routingInputHash &&
      previous.routingInputHash !== next.routingInputHash,
    )
  );
}
