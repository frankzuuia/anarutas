import type { OrderBoard, Shipment } from "../../src/core/orders-contract";
import type { RoutingSettings } from "../../src/core/routing-contract";

export const zoneSettings: RoutingSettings = {
  depotAddress: "Punto de prueba",
  depotLocation: { latitude: 20.65, longitude: -103.4, placeId: null },
  version: 1,
  updatedAt: null,
};
export function zoneShipment(
  index: number,
  overrides: Partial<Shipment> = {},
): Shipment {
  return {
    id: `s${index}`,
    pickingId: index,
    pickingName: `OUT/${index}`,
    orderId: index,
    orderName: `S${index}`,
    partnerId: index,
    customerName: `Cliente ${index}`,
    address: "",
    validatedAt: null,
    promisedAt: null,
    backorderId: null,
    lines: [],
    vehicle_id: "v0",
    position: index,
    window_start: null,
    window_end: null,
    high_priority: false,
    priority: "schedule",
    deliveryWindows: [],
    deliveryNote: "",
    phone: null,
    fulfillmentMode: "delivery",
    mapUrl: null,
    latitude: 20.65,
    longitude: -103.4,
    locationStatus: "confirmed",
    customerArchived: false,
    ...overrides,
  };
}
export function zoneBoard(shipments: Shipment[], count = 2): OrderBoard {
  return {
    plan: {
      id: "plan",
      version: 1,
      label: "QA",
      service_date: "2026-10-02",
      departure_minute: 480,
      updated_at: "2026-10-02T00:00:00Z",
    },
    vehicles: Array.from({ length: count }, (_, i) => ({
      id: `v${i}`,
      name: `Camioneta ${i}`,
      brand: "",
      model: "",
      plate: `P${i}`,
      mileage: "0",
      fuel: "Gasolina",
      available: true,
      driver_id: null,
      driver_name: null,
      version: 1,
    })),
    shipments,
  };
}
