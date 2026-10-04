import { describe, expect, it } from "vitest";
import { AppError } from "../src/core/errors";
import type { OrderBoard } from "../src/core/orders-contract";
import type { GoogleOptimizationResult } from "../src/core/route-optimization-google";
import { priorityConflictIds } from "../src/core/route-logistics-policy";
import { emptyMetrics } from "../src/core/route-road";
import {
  assertStrictPriorityResult,
  expandedRoutingCandidate,
  prioritizeRoutingCandidate,
  reconcileStrictPriorities,
} from "../src/core/route-strict-priority";
import { zoneBoard, zoneSettings, zoneShipment } from "./helpers/zone-board";

// Pure normalized-result contracts. These are neither a Google transport nor
// invented external receipts. Zero-distance measurements below run the actual
// road calculator at the depot, without an API substitute or injected readLeg.
function result(
  board: OrderBoard,
  sequences: number[][],
): GoogleOptimizationResult {
  const departureAt = "2026-10-02T08:00:00.000Z";
  const routes = sequences.map((indices, vehicleIndex) => ({
    vehicleIndex,
    departureAt,
    finishedAt: departureAt,
    encodedPolyline: null,
    metrics: { ...emptyMetrics(), performedShipmentCount: indices.length },
    transitions: [],
    visits: indices.map((shipmentIndex) => ({
      shipmentIndex,
      eta: departureAt,
      travelDistanceMeters: 0,
      travelDurationSeconds: 0,
      waitDurationSeconds: 0,
      priorityConflict: false,
    })),
  }));
  return {
    routes,
    skipped: [],
    metrics: {
      ...emptyMetrics(),
      performedShipmentCount: board.shipments.length,
    },
  };
}

describe("strict customer priority within each vehicle", () => {
  it("avoids a needless revisit at the last medium's point without advancing a schedule client before remaining highs", () => {
    const board = zoneBoard(
      [
        zoneShipment(1, { priority: "high" }),
        zoneShipment(2, { priority: "schedule" }),
        zoneShipment(3, { priority: "high", latitude: 20.66 }),
        zoneShipment(4, { priority: "medium", latitude: 20.67 }),
        zoneShipment(5, { priority: "schedule", latitude: 20.67 }),
      ],
      1,
    );
    const ordered = prioritizeRoutingCandidate(board, {
      routes: [
        { vehicleId: "v0", shipmentIds: ["s1", "s2", "s3", "s4", "s5"] },
      ],
    });
    expect(ordered.routes[0].shipmentIds).toEqual([
      "s1",
      "s3",
      "s4",
      "s5",
      "s2",
    ]);
    expect(priorityConflictIds(board.shipments, ordered).size).toBe(0);
  });

  it.each([1, 2, 4, 5, 6])(
    "separates a mixed point by tiers without changing any of %i vehicles",
    (count) => {
      const board = zoneBoard(
        [
          zoneShipment(1, { priority: "high" }),
          zoneShipment(2, { priority: "schedule" }),
          zoneShipment(3, { priority: "high", latitude: 20.66 }),
          zoneShipment(4, { priority: "medium", latitude: 20.67 }),
          zoneShipment(5, { priority: "medium", latitude: 20.68 }),
        ],
        count,
      );
      const incoming = {
        routes: board.vehicles.map((v, index) => ({
          vehicleId: v.id,
          shipmentIds: index === 0 ? ["s1", "s2", "s3", "s5", "s4"] : [],
        })),
      };
      const original = structuredClone(incoming);
      expect(priorityConflictIds(board.shipments, incoming).size).toBe(3);
      const ordered = prioritizeRoutingCandidate(board, incoming);
      expect(ordered.routes[0].shipmentIds).toEqual([
        "s1",
        "s3",
        "s5",
        "s4",
        "s2",
      ]);
      expect(
        ordered.routes.slice(1).every((r) => r.shipmentIds.length === 0),
      ).toBe(true);
      expect(ordered.routes.map((r) => r.vehicleId)).toEqual(
        board.vehicles.map((v) => v.id),
      );
      expect(priorityConflictIds(board.shipments, ordered).size).toBe(0);
      expect(incoming).toEqual(original);
    },
  );

  it("keeps relative order inside each tier and all orders of a shipping client together", () => {
    const board = zoneBoard(
      [
        zoneShipment(1, { priority: "medium", partnerId: 1 }),
        zoneShipment(2, { priority: "medium", partnerId: 1 }),
        zoneShipment(3, { priority: "high" }),
        zoneShipment(4, { priority: "schedule" }),
        zoneShipment(5, { priority: "high" }),
        zoneShipment(6, { priority: "medium" }),
      ],
      1,
    );
    const ordered = prioritizeRoutingCandidate(board, {
      routes: [
        {
          vehicleId: "v0",
          shipmentIds: ["s6", "s5", "s1", "s2", "s4", "s3"],
        },
      ],
    });
    expect(ordered.routes[0].shipmentIds).toEqual([
      "s5",
      "s3",
      "s6",
      "s1",
      "s2",
      "s4",
    ]);
  });

  it("does not enforce priorities globally across independent vehicles or merge near coordinates", () => {
    const board = zoneBoard(
      [
        zoneShipment(1, { priority: "schedule" }),
        zoneShipment(2, { priority: "medium", latitude: 20.650001 }),
        zoneShipment(3, { priority: "high", latitude: 20.66 }),
      ],
      3,
    );
    const candidate = {
      routes: board.vehicles.map((v, i) => ({
        vehicleId: v.id,
        shipmentIds: [`s${i + 1}`],
      })),
    };
    expect(prioritizeRoutingCandidate(board, candidate)).toEqual(candidate);
    expect(() =>
      assertStrictPriorityResult(board, result(board, [[0], [1], [2]])),
    ).not.toThrow();
  });

  it("rejects assigning different customers at the exact same point to different trucks", () => {
    const board = zoneBoard([zoneShipment(1), zoneShipment(2)]);
    const incoming = result(board, [[0], [1]]);
    expect(() => expandedRoutingCandidate(board, incoming)).toThrow(
      "ROUTING_RESPONSE_INVALID",
    );
    expect(() =>
      prioritizeRoutingCandidate(board, {
        routes: [
          { vehicleId: "v0", shipmentIds: ["s1"] },
          { vehicleId: "v1", shipmentIds: ["s2"] },
        ],
      }),
    ).toThrow("ROUTING_RESPONSE_INVALID");
  });

  it.each([
    "vehicle",
    "fractionalVehicle",
    "duplicateVehicle",
    "shipment",
    "fractionalShipment",
    "duplicateShipment",
    "missing",
    "skipped",
  ])("rejects a corrupt expanded result: %s", (kind) => {
    const board = zoneBoard([zoneShipment(1), zoneShipment(2)], 1);
    const incoming = result(board, [[0, 1]]);
    if (kind === "vehicle") incoming.routes[0].vehicleIndex = 9;
    if (kind === "fractionalVehicle") incoming.routes[0].vehicleIndex = 0.5;
    if (kind === "duplicateVehicle")
      incoming.routes.push(structuredClone(incoming.routes[0]));
    if (kind === "shipment") incoming.routes[0].visits[0].shipmentIndex = -1;
    if (kind === "fractionalShipment")
      incoming.routes[0].visits[0].shipmentIndex = 0.5;
    if (kind === "duplicateShipment")
      incoming.routes[0].visits[1].shipmentIndex = 0;
    if (kind === "missing") incoming.routes[0].visits.pop();
    if (kind === "skipped")
      incoming.skipped.push({ shipmentIndex: 0, reasons: [] });
    expect(() => expandedRoutingCandidate(board, incoming)).toThrow(AppError);
  });

  it("checks real priority instead of trusting zero conflict flags in the input", () => {
    const board = zoneBoard(
      [
        zoneShipment(1, { priority: "high" }),
        zoneShipment(2),
        zoneShipment(3, { priority: "high" }),
      ],
      1,
    );
    expect(() =>
      assertStrictPriorityResult(board, result(board, [[0, 1, 2]])),
    ).toThrow("ROUTING_RESPONSE_INVALID");
  });

  it("uses delivery indices while ignoring archived and pickup orders in the source board", () => {
    const board = zoneBoard(
      [
        zoneShipment(1, { fulfillmentMode: "pickup" }),
        zoneShipment(2, { customerArchived: true }),
        zoneShipment(3, { priority: "high" }),
        zoneShipment(4, { priority: "medium" }),
      ],
      2,
    );
    const incoming = result(board, [[0, 1]]);
    expect(expandedRoutingCandidate(board, incoming)).toEqual({
      routes: [
        { vehicleId: "v0", shipmentIds: ["s3", "s4"] },
        { vehicleId: "v1", shipmentIds: [] },
      ],
    });
    expect(() => assertStrictPriorityResult(board, incoming)).not.toThrow();
  });

  it("rejects missing coverage and noncontiguous customer orders before sorting", () => {
    const board = zoneBoard(
      [zoneShipment(1), zoneShipment(2, { partnerId: 1 }), zoneShipment(3)],
      1,
    );
    expect(() =>
      prioritizeRoutingCandidate(board, {
        routes: [{ vehicleId: "v0", shipmentIds: ["s1"] }],
      }),
    ).toThrow("ROUTING_CANDIDATE_INVALID");
    expect(() =>
      prioritizeRoutingCandidate(board, {
        routes: [{ vehicleId: "v0", shipmentIds: ["s1", "s3", "s2"] }],
      }),
    ).toThrow("ROUTING_CUSTOMER_GROUP_INVALID");
  });
});

describe("reconciliation uses actual measurements only for changed routes", () => {
  it("keeps global indices when only the second truck changes", async () => {
    const board = zoneBoard(
      [
        zoneShipment(1, { latitude: 20.66 }),
        zoneShipment(2),
        zoneShipment(3, { priority: "high" }),
      ],
      2,
    );
    const incoming = result(board, [[0], [1, 2]]);
    const corrected = await reconcileStrictPriorities(
      board,
      incoming,
      zoneSettings,
      "UTC",
    );
    expect(corrected.reorderedVehicleIds).toEqual(["v1"]);
    expect(corrected.result.routes[0]).toBe(incoming.routes[0]);
    expect(corrected.result.routes[1].vehicleIndex).toBe(1);
    expect(
      corrected.result.routes[1].visits.map((v) => v.shipmentIndex),
    ).toEqual([2, 1]);
  });

  it("supports the default progress callback for a corrected zero-distance route", async () => {
    const board = zoneBoard(
      [
        zoneShipment(1, { priority: "high" }),
        zoneShipment(2),
        zoneShipment(3, { priority: "high" }),
      ],
      1,
    );
    const corrected = await reconcileStrictPriorities(
      board,
      result(board, [[0, 1, 2]]),
      zoneSettings,
      "UTC",
    );
    expect(
      corrected.result.routes[0].visits.map((v) => v.shipmentIndex),
    ).toEqual([0, 2, 1]);
  });

  it("retains the exact provider result when no truck needs an order change", async () => {
    const board = zoneBoard(
      [zoneShipment(1, { priority: "high" }), zoneShipment(2)],
      2,
    );
    const incoming = result(board, [[0, 1]]);
    const corrected = await reconcileStrictPriorities(
      board,
      incoming,
      zoneSettings,
      "UTC",
    );
    expect(corrected.result).toBe(incoming);
    expect(corrected.reorderedVehicleIds).toEqual([]);
  });

  it("recalculates depot deliveries and unloading, retains an unchanged truck, and keeps global delivery indices", async () => {
    const board = zoneBoard(
      [
        zoneShipment(1, { fulfillmentMode: "pickup" }),
        zoneShipment(2, { priority: "schedule", unloadingMinutes: 3 }),
        zoneShipment(3, { priority: "high", unloadingMinutes: 5 }),
        zoneShipment(4, { priority: "medium", unloadingMinutes: 2 }),
        zoneShipment(5, { priority: "high", latitude: 20.66 }),
      ],
      2,
    );
    const incoming = result(board, [[0, 1, 2], [3]]);
    incoming.routes[1].encodedPolyline = "untouched-trace";
    const original = structuredClone(incoming);
    let progress = 0;
    const corrected = await reconcileStrictPriorities(
      board,
      incoming,
      zoneSettings,
      "UTC",
      async () => {
        progress++;
      },
    );
    expect(corrected.reorderedVehicleIds).toEqual(["v0"]);
    expect(
      corrected.result.routes[0].visits.map((v) => v.shipmentIndex),
    ).toEqual([1, 2, 0]);
    expect(corrected.result.routes[0]).toMatchObject({
      departureAt: "2026-10-02T08:00:00.000Z",
      finishedAt: "2026-10-02T08:10:00.000Z",
      encodedPolyline: null,
      transitions: [],
      metrics: {
        totalDurationSeconds: 600,
        travelDistanceMeters: 0,
        performedShipmentCount: 3,
      },
    });
    expect(corrected.result.routes[1]).toBe(incoming.routes[1]);
    expect(corrected.result.metrics).toEqual({
      ...emptyMetrics(),
      totalDurationSeconds: 600,
      performedShipmentCount: 4,
    });
    expect(progress).toBe(4);
    expect(incoming).toEqual(original);
    expect(() =>
      assertStrictPriorityResult(board, corrected.result),
    ).not.toThrow();
  });

  it("propagates lost authorization/version progress without changing the incoming result", async () => {
    const board = zoneBoard(
      [zoneShipment(1), zoneShipment(2, { priority: "high" })],
      1,
    );
    const incoming = result(board, [[0, 1]]);
    const original = structuredClone(incoming);
    await expect(
      reconcileStrictPriorities(
        board,
        incoming,
        zoneSettings,
        "UTC",
        async () => {
          throw new AppError("VERSION_CONFLICT", 409);
        },
      ),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(incoming).toEqual(original);
  });
});
