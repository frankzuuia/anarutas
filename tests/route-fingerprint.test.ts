import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { OrderBoard } from "../src/core/orders-contract";
import { routeFingerprint } from "../src/core/route-fingerprint";

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
});
