import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { OrderBoard } from "../src/core/orders-contract";
import {
  routeFingerprint,
  vehicleRouteFingerprints,
} from "../src/core/route-fingerprint";

const board: OrderBoard = {
  plan: {
    id: "00000000-0000-4000-8000-000000000001",
    service_date: "2026-09-10",
    label: "QA",
    version: 7,
    updated_at: "2026-09-10T00:00:00Z",
    departure_minute: 480,
  },
  vehicles: [
    {
      id: "00000000-0000-4000-8000-000000000011",
      name: "Ford",
      brand: "Ford",
      model: "2026",
      plate: "QA",
      mileage: "0",
      fuel: "Gasolina",
      available: true,
      driver_id: "00000000-0000-4000-8000-000000000012",
      driver_name: "Chofer",
      version: 1,
    },
  ],
  shipments: [
    {
      id: "00000000-0000-4000-8000-000000000021",
      pickingId: 1,
      pickingName: "WH/OUT/1",
      orderId: 1,
      orderName: "S1",
      partnerId: 1,
      customerName: "Dato no ejecutable",
      address: "",
      validatedAt: "2026-09-10T00:00:00Z",
      promisedAt: null,
      backorderId: null,
      lines: [],
      vehicle_id: "00000000-0000-4000-8000-000000000011",
      position: 3,
      window_start: "09:00",
      window_end: "11:00",
      high_priority: true,
      priority: "high",
      deliveryWindows: [{ startMinute: 540, endMinute: 660 }],
      deliveryNote: "",
      phone: null,
      fulfillmentMode: "delivery",
      mapUrl: null,
      latitude: 20.6,
      longitude: -103.3,
      locationStatus: "confirmed",
      customerArchived: false,
    },
  ],
};

describe("route input fingerprint", () => {
  it("binds every operational field, including explicit manual position", () => {
    const operationalPayload = {
      policy: "warehouse-return-v1",
      date: "2026-09-10",
      departure: 480,
      settingsVersion: 4,
      vehicles: [
        {
          id: "00000000-0000-4000-8000-000000000011",
          name: "Ford",
          driver: "00000000-0000-4000-8000-000000000012",
        },
      ],
      shipments: [
        {
          id: "00000000-0000-4000-8000-000000000021",
          partnerId: 1,
          vehicle: "00000000-0000-4000-8000-000000000011",
          position: 3,
          latitude: 20.6,
          longitude: -103.3,
          windows: [{ startMinute: 540, endMinute: 660 }],
          priority: "high",
          mode: "delivery",
          archived: false,
          locationStatus: "confirmed",
        },
      ],
    };
    expect(routeFingerprint(board, 4)).toBe(
      createHash("sha256")
        .update(JSON.stringify(operationalPayload))
        .digest("hex"),
    );
  });

  it("changes when the administrator changes the assignment or order", () => {
    const baseline = routeFingerprint(board, 4);
    const moved = structuredClone(board);
    moved.shipments[0].position = 4;
    const reassigned = structuredClone(board);
    reassigned.shipments[0].vehicle_id = null;
    expect(routeFingerprint(moved, 4)).not.toBe(baseline);
    expect(routeFingerprint(reassigned, 4)).not.toBe(baseline);
    expect(routeFingerprint(board, 5)).not.toBe(baseline);
    const otherCustomer = structuredClone(board);
    otherCustomer.shipments[0].partnerId = 2;
    expect(routeFingerprint(otherCustomer, 4)).not.toBe(baseline);
  });

  it("invalidates only the truck whose ordered stops change", () => {
    const twoTrucks = structuredClone(board);
    const otherTruck = {
      ...twoTrucks.vehicles[0],
      id: "00000000-0000-4000-8000-000000000031",
      name: "Expert",
      driver_id: "00000000-0000-4000-8000-000000000032",
    };
    twoTrucks.vehicles.push(otherTruck);
    twoTrucks.shipments.push({
      ...twoTrucks.shipments[0],
      id: "00000000-0000-4000-8000-000000000041",
      orderId: 2,
      orderName: "S2",
      vehicle_id: otherTruck.id,
      position: 4,
    });
    const baseline = vehicleRouteFingerprints(twoTrucks, 4);
    const changed = structuredClone(twoTrucks);
    changed.shipments[0].latitude = 20.7;
    changed.shipments[1].position = 100;
    const after = vehicleRouteFingerprints(changed, 4);
    expect(after[twoTrucks.vehicles[0].id]).not.toBe(
      baseline[twoTrucks.vehicles[0].id],
    );
    expect(after[otherTruck.id]).toBe(baseline[otherTruck.id]);

    changed.shipments[0].vehicle_id = otherTruck.id;
    const transferred = vehicleRouteFingerprints(changed, 4);
    expect(transferred[twoTrucks.vehicles[0].id]).not.toBe(
      baseline[twoTrucks.vehicles[0].id],
    );
    expect(transferred[otherTruck.id]).not.toBe(baseline[otherTruck.id]);
  });

  it("binds the complete per-truck route contract in deterministic stop order", () => {
    const input = structuredClone(board);
    const second = {
      ...input.shipments[0],
      id: "00000000-0000-4000-8000-000000000022",
      position: 1,
      partnerId: 2,
    };
    const third = {
      ...input.shipments[0],
      id: "00000000-0000-4000-8000-000000000020",
      position: 1,
      partnerId: 3,
    };
    input.shipments.push(second, third);
    const snapshot = (shipment: (typeof input.shipments)[number]) => ({
      id: shipment.id,
      partnerId: shipment.partnerId,
      latitude: shipment.latitude,
      longitude: shipment.longitude,
      windows: shipment.deliveryWindows,
      priority: shipment.priority,
      mode: shipment.fulfillmentMode,
      archived: shipment.customerArchived,
      locationStatus: shipment.locationStatus,
    });
    const expected = createHash("sha256")
      .update(
        JSON.stringify({
          date: "2026-09-10",
          departure: 480,
          settingsVersion: 4,
          vehicleId: "00000000-0000-4000-8000-000000000011",
          shipments: [
            snapshot(third),
            snapshot(second),
            snapshot(input.shipments[0]),
          ],
        }),
      )
      .digest("hex");
    expect(vehicleRouteFingerprints(input, 4)[input.vehicles[0].id]).toBe(
      expected,
    );
    input.shipments.reverse();
    expect(vehicleRouteFingerprints(input, 4)[input.vehicles[0].id]).toBe(
      expected,
    );
    input.vehicles[0].name = "Renombrada";
    input.vehicles[0].driver_id = "00000000-0000-4000-8000-000000000099";
    expect(vehicleRouteFingerprints(input, 4)[input.vehicles[0].id]).toBe(
      expected,
    );
  });
});
