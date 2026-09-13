import { describe, expect, it } from "vitest";
import { forecastIncidents } from "../src/core/route-incidents";
import type { PublicOptimization } from "../src/core/routing-contract";

const metrics = {
  travelDistanceMeters: 0,
  travelDurationSeconds: 0,
  waitDurationSeconds: 0,
  totalDurationSeconds: 0,
  performedShipmentCount: 0,
};
function input() {
  return {
    plan: { id: "plan", version: 2 },
    vehicles: [{ id: "truck", name: "Camioneta", driver_name: "Chofer" }],
    shipments: ["s1", "s2"].map((id) => ({
      id,
      partnerId: 1,
      customerName: "Kalamar",
      orderName: id,
      pickingName: `Entrega ${id}`,
      fulfillmentMode: "delivery" as const,
      customerArchived: false,
      deliveryWindows: [{ startMinute: 600, endMinute: 690 }],
    })),
  };
}
function result(): PublicOptimization {
  return {
    runId: "run",
    planId: "plan",
    appliedPlanVersion: 2,
    current: true,
    createdAt: "2026-09-12T07:00:00Z",
    metrics,
    skipped: [],
    routes: [
      {
        vehicleId: "truck",
        vehicleName: "Camioneta",
        encodedPolyline: null,
        metrics,
        stops: ["s1", "s2"].map((shipmentId, index) => ({
          shipmentId,
          position: index + 1,
          eta: "2026-09-12T12:00:00Z",
          travelDistanceMeters: 0,
          travelDurationSeconds: 0,
          waitDurationSeconds: 0,
          lateSeconds: 1800,
        })),
      },
    ],
  };
}

describe("forecast incidents read model (no delivery events)", () => {
  it("shows Kalamar once with both orders and 30 predicted minutes, without inventing an arrival", () => {
    const board = input(),
      calculation = result();
    const original = structuredClone({ board, calculation });
    const forecast = forecastIncidents(board, calculation);
    expect(forecast).toEqual({
      kind: "ready",
      unmeasured: 0,
      rows: [
        {
          destinationId: "s1",
          customer: "Kalamar",
          orders: ["s1", "s2"],
          vehicle: "Camioneta",
          driver: "Chofer",
          windows: [{ startMinute: 600, endMinute: 690 }],
          eta: "2026-09-12T12:00:00Z",
          lateSeconds: 1800,
        },
      ],
    });
    expect(forecast.rows[0]).not.toHaveProperty("arrivedAt");
    expect(forecast.rows[0]).not.toHaveProperty("deliveredAt");
    expect({ board, calculation }).toEqual(original);
  });

  it("does not label missing or obsolete calculations as zero incidents", () => {
    expect(forecastIncidents(input(), null)).toEqual({
      kind: "missing",
      rows: [],
      unmeasured: 0,
    });
    for (const change of [
      { current: false },
      { planId: "other" },
      { appliedPlanVersion: 1 },
      { appliedPlanVersion: 3 },
    ]) {
      expect(forecastIncidents(input(), { ...result(), ...change })).toEqual({
        kind: "stale",
        rows: [],
        unmeasured: 0,
      });
    }
  });

  it("marks missing measurements and ignores on-time destinations without changing counts to fit", () => {
    const calculation = result();
    calculation.routes[0].stops.pop();
    expect(forecastIncidents(input(), calculation)).toEqual({
      kind: "ready",
      rows: [],
      unmeasured: 1,
    });
    const legacy = result();
    delete legacy.routes[0].stops[1].lateSeconds;
    expect(forecastIncidents(input(), legacy).unmeasured).toBe(1);
    for (const seconds of [0, -1]) {
      const ontime = result();
      ontime.routes[0].stops.forEach((s) => {
        s.lateSeconds = seconds;
      });
      expect(forecastIncidents(input(), ontime)).toEqual({
        kind: "ready",
        rows: [],
        unmeasured: 0,
      });
    }
  });

  it("uses the largest delay per destination, orders descending, keeps branches separate and resolves missing driver", () => {
    const board = input(),
      calculation = result();
    board.shipments[1].orderName = "s1";
    board.shipments.push({
      ...board.shipments[0],
      id: "s3",
      partnerId: 2,
      customerName: "Sucursal",
      orderName: "",
      pickingName: "WH/3",
    });
    calculation.routes[0].stops[1].lateSeconds = 1900;
    calculation.routes[0].stops[1].eta = "2026-09-12T12:01:40Z";
    calculation.routes[0].stops.push({
      ...calculation.routes[0].stops[0],
      shipmentId: "s3",
      lateSeconds: 2500,
    });
    const forecast = forecastIncidents(board, calculation);
    expect(
      forecast.rows.map((r) => [r.customer, r.lateSeconds, r.orders]),
    ).toEqual([
      ["Sucursal", 2500, ["WH/3"]],
      ["Kalamar", 1900, ["s1"]],
    ]);
    expect(forecast.rows[1].eta).toBe("2026-09-12T12:01:40Z");
    calculation.routes[0].stops[2].lateSeconds = 1900;
    expect(
      forecastIncidents(board, calculation).rows.map((r) => r.customer),
    ).toEqual(["Kalamar", "Sucursal"]);
    board.vehicles = [];
    expect(
      forecastIncidents(board, calculation).rows.every(
        (r) => r.driver === null,
      ),
    ).toBe(true);
    board.shipments.forEach((s) => {
      s.customerArchived = true;
    });
    expect(forecastIncidents(board, calculation).rows).toEqual([]);
  });
});
