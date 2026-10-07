import { describe, expect, it } from "vitest";
import {
  routePublicationContentChanged,
  routePublicationSnapshot,
  routePublicationSourceChanged,
} from "../src/core/route-publication-content";

type Snapshot = ReturnType<typeof routePublicationSnapshot>;

describe("publication content comparison", () => {
  const snapshot: Snapshot = {
    plan: {
      id: "plan",
      label: "Jornada",
      serviceDate: "2026-09-23",
      version: 5,
    },
    vehicle: { id: "vehicle", name: "Expert", plate: "UNIT-1" },
    orders: [],
    routeStatus: "current",
    route: null,
    routingInputHash: "input-a",
  };

  it("ignores global plan version and JSONB key ordering, including older snapshots", () => {
    const next = { ...snapshot, plan: { ...snapshot.plan, version: 6 } };
    expect(routePublicationContentChanged(snapshot, next)).toBe(false);
    const legacy: Partial<Snapshot> = structuredClone(snapshot);
    delete legacy.routingInputHash;
    const reordered = { ...legacy };
    // Real JSONB reorders keys recursively; object insertion order is not content.
    reordered.plan = {
      version: 5,
      serviceDate: snapshot.plan.serviceDate,
      label: "Jornada",
      id: "plan",
    };
    reordered.vehicle = { plate: "UNIT-1", name: "Expert", id: "vehicle" };
    expect(routePublicationContentChanged(reordered, next)).toBe(false);
  });

  it("detects changed route inputs, metadata, payload and route separately", () => {
    expect(
      routePublicationContentChanged(snapshot, {
        ...snapshot,
        routingInputHash: "input-b",
      }),
    ).toBe(true);
    expect(
      routePublicationContentChanged(snapshot, {
        ...snapshot,
        plan: { ...snapshot.plan, label: "Otra jornada" },
      }),
    ).toBe(true);
    expect(
      routePublicationContentChanged(snapshot, {
        ...snapshot,
        plan: { ...snapshot.plan, id: "another-plan" },
      }),
    ).toBe(true);
    expect(
      routePublicationContentChanged(snapshot, {
        ...snapshot,
        plan: { ...snapshot.plan, serviceDate: "2026-09-24" },
      }),
    ).toBe(true);
    expect(
      routePublicationContentChanged(snapshot, {
        ...snapshot,
        vehicle: { ...snapshot.vehicle, plate: "UNIT-2" },
      }),
    ).toBe(true);
    expect(
      routePublicationContentChanged(snapshot, {
        ...snapshot,
        routeStatus: "stale",
      }),
    ).toBe(true);
    expect(
      routePublicationContentChanged(snapshot, {
        ...snapshot,
        route: {
          vehicleId: "vehicle",
          vehicleName: "Expert",
          encodedPolyline: null,
          stops: [],
          metrics: {
            travelDistanceMeters: 100,
            travelDurationSeconds: 60,
            waitDurationSeconds: 0,
            totalDurationSeconds: 60,
            performedShipmentCount: 0,
          },
        },
      }),
    ).toBe(true);
    expect(routePublicationContentChanged({}, snapshot)).toBe(true);
  });

  it("compares own sequence and order payload, not global position slots", () => {
    const order: Snapshot["orders"][number] = {
      id: "shipment-a",
      orderName: "S1",
      customerName: "Cliente A",
      unloadingMinutes: null,
      address: "Domicilio A",
      position: 2,
      phone: null,
      priority: "schedule",
      deliveryWindows: [],
      deliveryNote: "",
      fulfillmentMode: "delivery",
      latitude: null,
      longitude: null,
      locationStatus: "pending",
      lines: [],
    };
    const previous = {
      ...snapshot,
      orders: [order, { ...order, id: "shipment-b", position: 4 }],
    };
    const next = {
      ...snapshot,
      orders: previous.orders.map((item) => ({
        ...item,
        position: item.position + 3,
      })),
    };
    expect(routePublicationContentChanged(previous, next)).toBe(false);
    expect(
      routePublicationContentChanged(previous, {
        ...next,
        orders: [...next.orders].reverse(),
      }),
    ).toBe(true);
    expect(
      routePublicationContentChanged(previous, {
        ...next,
        orders: [next.orders[0]],
      }),
    ).toBe(true);
    expect(
      routePublicationContentChanged(previous, {
        ...next,
        orders: next.orders.map((item) => ({
          ...item,
          deliveryNote: "Acceso nuevo",
        })),
      }),
    ).toBe(true);
  });

  it("start checks exact source products while preserving published metadata and sequence", () => {
    const line = {
      name: "Producto",
      quantity: 3,
      unit: "kg",
      pickerNote: null,
    };
    const order: Snapshot["orders"][number] = {
      id: "shipment-a",
      orderName: "S1",
      customerName: "Cliente",
      unloadingMinutes: null,
      address: "Domicilio",
      position: 1,
      phone: null,
      priority: "schedule",
      deliveryWindows: [],
      deliveryNote: "",
      fulfillmentMode: "delivery",
      latitude: null,
      longitude: null,
      locationStatus: "pending",
      lines: [line],
    };
    const previous = {
      ...snapshot,
      orders: [order, { ...order, id: "shipment-b", position: 2 }],
    };
    const shipments: Parameters<typeof routePublicationSourceChanged>[1] =
      previous.orders.map((o) => ({
        id: o.id,
        fulfillmentStatus: "validated",
        lines: [
          {
            moveId: 1,
            productId: 1,
            name: "Producto",
            quantity: 3,
            unit: "kg",
          },
        ],
      }));
    expect(
      routePublicationSourceChanged(previous, [...shipments].reverse()),
    ).toBe(false);
    expect(
      routePublicationSourceChanged(
        { ...previous, plan: { ...previous.plan, label: "Nombre anterior" } },
        shipments,
      ),
    ).toBe(false);
    expect(routePublicationSourceChanged({}, shipments)).toBe(true);
    expect(routePublicationSourceChanged(previous, shipments.slice(0, 1))).toBe(
      true,
    );
    expect(
      routePublicationSourceChanged(previous, [
        ...shipments,
        { ...shipments[0], id: "shipment-new" },
      ]),
    ).toBe(true);
    expect(
      routePublicationSourceChanged(previous, [
        { ...shipments[0], id: "removed" },
        shipments[1],
      ]),
    ).toBe(true);
    expect(
      routePublicationSourceChanged(previous, [
        { ...shipments[0], fulfillmentStatus: "cancelled" },
        shipments[1],
      ]),
    ).toBe(true);
    expect(
      routePublicationSourceChanged(previous, [
        { ...shipments[0], lines: [] },
        shipments[1],
      ]),
    ).toBe(true);
    for (const patch of [
      { quantity: 3.2 },
      { name: "Producto sustituido" },
      { unit: "Unidades" },
      { pickerNote: "Surtido actualizado" },
    ])
      expect(
        routePublicationSourceChanged(previous, [
          { ...shipments[0], lines: [{ ...shipments[0].lines[0], ...patch }] },
          shipments[1],
        ]),
      ).toBe(true);
    const legacy = JSON.parse(JSON.stringify(previous));
    for (const o of legacy.orders) delete o.lines[0].pickerNote;
    expect(routePublicationSourceChanged(legacy, shipments)).toBe(false);
  });
});
