import { describe, expect, it } from "vitest";
import type { OrderBoard, Shipment } from "../src/core/orders-contract";
import {
  compareLogisticsScores,
  hasRoutingAlternatives,
  logisticsScoreKeys,
  logisticsSignature,
  prioritizeCandidate,
  priorityConflictIds,
  priorityGroups,
  type LogisticsScore,
  type RoutingCandidate,
} from "../src/core/route-logistics-policy";
import { buildGoogleOptimizationRequest } from "../src/core/route-optimization-google";
import {
  candidateCommitDecision,
  evaluateCandidate,
  parseCandidate,
  planningSnapshot,
  proposalCandidate,
  toolResult,
} from "../src/core/route-ai-planner";
import { calculateManualRoutes } from "../src/core/route-road";
import {
  allocationSignature,
  logisticsComparison,
} from "../src/core/route-logistics-search";

// Pure domain cases. No network/provider substitutions: coincident points have
// exactly zero road distance, and visit waiting is computed by the real engine.
function shipment(
  id: string,
  partnerId: number,
  priority: Shipment["priority"],
): Shipment {
  return {
    id,
    partnerId,
    priority,
    pickingId: partnerId,
    pickingName: id,
    orderId: partnerId,
    orderName: id,
    customerName: "Private customer",
    address: "Private address",
    validatedAt: null,
    promisedAt: null,
    backorderId: null,
    lines: [],
    vehicle_id: null,
    position: 1,
    window_start: null,
    window_end: null,
    high_priority: null,
    deliveryWindows: [],
    deliveryNote: "",
    phone: null,
    fulfillmentMode: "delivery",
    mapUrl: null,
    latitude: 20,
    longitude: -103,
    locationStatus: "confirmed",
    customerArchived: false,
  };
}
function board(): OrderBoard {
  return {
    plan: {
      id: "plan",
      label: "QA",
      service_date: "2026-09-12",
      departure_minute: 480,
      version: 1,
      updated_at: "2026-09-12T08:00:00Z",
    },
    vehicles: ["v1", "v2"].map((id) => ({
      id,
      name: id,
      brand: "Ford",
      model: "2026",
      plate: id,
      mileage: "0",
      fuel: "Gasolina",
      available: true,
      driver_id: null,
      driver_name: null,
      version: 1,
    })),
    shipments: [
      shipment("schedule", 1, "schedule"),
      shipment("medium", 2, "medium"),
      shipment("high", 3, "high"),
    ],
  };
}
const settings = {
  depotAddress: "",
  depotLocation: { latitude: 20, longitude: -103, placeId: null },
  version: 1,
  updatedAt: null,
};
const candidate = (ids: string[]): RoutingCandidate => ({
  routes: [
    { vehicleId: "v1", shipmentIds: ids },
    { vehicleId: "v2", shipmentIds: [] },
  ],
});

describe("logistics precedence and physical-stop quality", () => {
  it("versions the operational policy and publishes the explicit objective order", () => {
    const snapshot = planningSnapshot(board(), settings, "America/Mexico_City");
    expect(snapshot.timezone).toBe("America/Mexico_City");
    expect(snapshot.policy).toEqual({
      version: "priority-per-route-v1",
      priorityScope: "per_vehicle",
      compareAlternatives: true,
      scoreOrder: [
        "priorityConflicts",
        "lateStops",
        "lateSeconds",
        "unusedVehicles",
        "makespanSeconds",
        "imbalanceSeconds",
        "waitSeconds",
        "travelSeconds",
        "distanceMeters",
      ],
    });
  });
  it("repairs the reported priority-at-bottom case before measuring, even at identical ETAs", async () => {
    const source = board();
    const input = candidate(["schedule", "medium", "high"]);
    const original = structuredClone(input);
    expect(priorityConflictIds(source.shipments, input)).toEqual(
      new Set(["medium", "high"]),
    );
    const normalized = prioritizeCandidate(source.shipments, input);
    expect(normalized).toEqual(candidate(["high", "medium", "schedule"]));
    expect(input).toEqual(original);
    expect(prioritizeCandidate(source.shipments, normalized)).toEqual(
      normalized,
    );
    expect(priorityConflictIds(source.shipments, normalized).size).toBe(0);
    const result = await evaluateCandidate(
      source,
      parseCandidate(input, source),
      settings,
      "UTC",
    );
    expect(result.candidate).toEqual(normalized);
    expect(result.score.priorityConflicts).toBe(0);
    expect(result.result.routes[0].stops.map((s) => s.shipmentId)).toEqual([
      "high",
      "medium",
      "schedule",
    ]);
    expect(new Set(result.result.routes[0].stops.map((s) => s.eta)).size).toBe(
      1,
    );
  });

  it("preserves model sequence within tiers and uses the strongest priority of an intact customer group", () => {
    const source = board();
    source.shipments.push(
      shipment("high2", 3, "schedule"),
      shipment("schedule2", 4, "schedule"),
    );
    const input = candidate([
      "schedule2",
      "schedule",
      "high2",
      "high",
      "medium",
    ]);
    expect(prioritizeCandidate(source.shipments, input)).toEqual(
      candidate(["high", "high2", "medium", "schedule2", "schedule"]),
    );
    expect(
      priorityGroups(source.shipments).find((g) => g.id === "high"),
    ).toEqual({
      id: "high",
      shipmentIds: ["high", "high2"],
      rank: 0,
      priority: "high",
    });
    expect(
      priorityConflictIds(
        source.shipments,
        candidate(["medium", "high2", "high", "schedule", "schedule2"]),
      ),
    ).toEqual(new Set(["high", "high2"]));
  });

  it("allows independent trucks to deliver while another high-priority destination is still closed", async () => {
    const source = board();
    source.shipments[2].deliveryWindows = [
      { startMinute: 600, endMinute: 660 },
    ];
    const split = {
      routes: [
        { vehicleId: "v1", shipmentIds: ["high"] },
        { vehicleId: "v2", shipmentIds: ["medium", "schedule"] },
      ],
    };
    const result = await evaluateCandidate(source, split, settings, "UTC");
    expect(result.priorityConflicts).toBe(0);
    expect(result.result.routes[0].stops[0].eta).toBe(
      "2026-09-12T10:00:00.000Z",
    );
    expect(result.result.routes[1].stops[0].eta).toBe(
      "2026-09-12T08:00:00.000Z",
    );
    expect(result.imbalanceSeconds).toBe(7200);
  });

  it("keeps manual order and reports its priority conflict rather than silently rearranging it", async () => {
    const source = board();
    source.shipments = source.shipments
      .map((s, position) => ({
        ...s,
        vehicle_id: "v1",
        position: position + 1,
      }))
      .reverse();
    const measured = await calculateManualRoutes(source, settings, "UTC");
    expect(
      measured.routes[0].stops.map((s) => [s.shipmentId, s.priorityConflict]),
    ).toEqual([
      ["schedule", false],
      ["medium", true],
      ["high", true],
    ]);
  });

  it("drains the other truck's in-flight calculations before reporting a failed truck", async () => {
    const source = board();
    source.shipments[0].vehicle_id = "v1";
    source.shipments[0].locationStatus = "pending";
    source.shipments[1].vehicle_id = "v2";
    source.shipments[2].vehicle_id = "v2";
    let completed = 0;
    const result = calculateManualRoutes(source, settings, "UTC", async () => {
      await Promise.resolve();
      await Promise.resolve();
      completed++;
    });
    await expect(result).rejects.toMatchObject({
      code: "ROUTING_POINTS_REQUIRED",
    });
    expect(completed).toBe(3);
  });

  it("retains all deliveries and exposes exact late/wait timings without counting repeated orders as extra late destinations", async () => {
    const source = board();
    source.shipments[2].deliveryWindows = [
      { startMinute: 360, endMinute: 420 },
    ];
    source.shipments.push({ ...source.shipments[2], id: "high2" });
    source.shipments[1].deliveryWindows = [
      { startMinute: 300, endMinute: 400 },
      { startMinute: 540, endMinute: 600 },
    ];
    const result = await evaluateCandidate(
      source,
      candidate(["schedule", "high", "high2", "medium"]),
      settings,
      "UTC",
    );
    expect(result.result.metrics.performedShipmentCount).toBe(4);
    expect(result.score).toMatchObject({
      priorityConflicts: 0,
      lateStops: 1,
      lateSeconds: 3600,
      waitSeconds: 3600,
    });
    const feedback = toolResult(result);
    expect(feedback.routes[0].stops).toMatchObject([
      {
        shipmentId: "high",
        eta: "2026-09-12T08:00:00.000Z",
        lateSeconds: 3600,
        priority: "high",
      },
      {
        shipmentId: "high2",
        eta: "2026-09-12T08:00:00.000Z",
        lateSeconds: 3600,
      },
      {
        shipmentId: "medium",
        eta: "2026-09-12T09:00:00.000Z",
        waitDurationSeconds: 3600,
        lateSeconds: 0,
      },
      { shipmentId: "schedule", lateSeconds: 0 },
    ]);
    expect(JSON.stringify(feedback)).not.toContain("Private");
    expect(feedback.timezone).toBe("UTC");
    expect(feedback.routes[0]).toMatchObject({
      destinations: 3,
      idleUntilFleetReturnSeconds: 0,
      travelSeconds: 0,
    });
    expect(feedback.routes[1].idleUntilFleetReturnSeconds).toBe(3600);
    expect(feedback.routes[0].stops).toMatchObject([
      {
        closingSlackSeconds: -3600,
        destinationId: "high",
        groupPriority: "high",
      },
      {
        closingSlackSeconds: -3600,
        destinationId: "high",
        groupPriority: "high",
      },
      { arrivalAt: "2026-09-12T08:00:00.000Z", closingSlackSeconds: 3600 },
      { closingSlackSeconds: null },
    ]);
  });

  it("improves measured lateness by changing allocation even when both candidates have correct identical priorities", async () => {
    const source = board();
    source.shipments.forEach((s) => {
      s.priority = "schedule";
    });
    source.shipments[0].deliveryWindows = [
      { startMinute: 720, endMinute: 780 },
    ];
    source.shipments[1].deliveryWindows = [
      { startMinute: 480, endMinute: 540 },
    ];
    source.shipments[2].deliveryWindows = [
      { startMinute: 480, endMinute: 540 },
    ];
    const bad = await evaluateCandidate(
      source,
      candidate(["schedule", "medium", "high"]),
      settings,
      "UTC",
    );
    const split = await evaluateCandidate(
      source,
      {
        routes: [
          { vehicleId: "v1", shipmentIds: ["medium", "high"] },
          { vehicleId: "v2", shipmentIds: ["schedule"] },
        ],
      },
      settings,
      "UTC",
    );
    expect(bad.score).toMatchObject({
      priorityConflicts: 0,
      lateStops: 2,
      lateSeconds: 21600,
    });
    expect(split.score).toMatchObject({
      priorityConflicts: 0,
      lateStops: 0,
      lateSeconds: 0,
      unusedVehicles: 0,
    });
    expect(compareLogisticsScores(split.score, bad.score)).toBeLessThan(0);
    const reordered = await evaluateCandidate(
      source,
      candidate(["medium", "high", "schedule"]),
      settings,
      "UTC",
    );
    expect(reordered.score.lateStops).toBe(0);
    expect(compareLogisticsScores(reordered.score, bad.score)).toBeLessThan(0);
    expect(compareLogisticsScores(split.score, reordered.score)).toBeLessThan(
      0,
    );
    expect(split.result.metrics.performedShipmentCount).toBe(3);
    expect(toolResult(bad).routes[0].stops[0]).toMatchObject({
      arrivalAt: "2026-09-12T08:00:00.000Z",
      eta: "2026-09-12T12:00:00.000Z",
      waitDurationSeconds: 14400,
      closingSlackSeconds: 3600,
    });
  });

  it("allows departure at 23:59 with every delivery window already closed", async () => {
    const source = board();
    source.plan.departure_minute = 1439;
    source.shipments.forEach((s) => {
      s.deliveryWindows = [{ startMinute: 420, endMinute: 480 }];
    });
    const measured = await evaluateCandidate(
      source,
      candidate(["schedule", "medium", "high"]),
      settings,
      "America/Mexico_City",
    );
    expect(measured.feasible).toBe(true);
    expect(measured.result.metrics.performedShipmentCount).toBe(
      source.shipments.length,
    );
    expect(measured.lateStops).toBe(3);
    expect(measured.score.lateSeconds).toBe(3 * (1439 - 480) * 60);
    expect(candidateCommitDecision(measured, measured, true)).toEqual({
      chosen: measured,
    });
    const window = buildGoogleOptimizationRequest(
      source,
      settings,
      "America/Mexico_City",
    ).model.shipments[0].deliveries[0].timeWindows![0];
    expect(window.startTime).toBe("2026-09-13T05:59:00.000Z");
    expect(window.softEndTime).toBe(window.startTime);
  });

  it("requires separate measured allocation and sequence evidence around the best candidate", () => {
    const source = board();
    source.shipments.forEach((s) => {
      s.priority = "schedule";
    });
    source.shipments.push(shipment("fourth", 4, "schedule"));
    const best = {
      routes: [
        { vehicleId: "v1", shipmentIds: ["schedule", "medium"] },
        { vehicleId: "v2", shipmentIds: ["high", "fourth"] },
      ],
    };
    const reordered = structuredClone(best);
    reordered.routes[0].shipmentIds.reverse();
    const swappedNames = {
      routes: best.routes
        .map((r) => ({ ...r, vehicleId: r.vehicleId === "v1" ? "v2" : "v1" }))
        .reverse(),
    };
    expect(allocationSignature(reordered)).toBe(allocationSignature(best));
    expect(logisticsSignature(reordered)).not.toBe(logisticsSignature(best));
    const reassigned = {
      routes: [
        { vehicleId: "v1", shipmentIds: ["schedule", "high"] },
        { vehicleId: "v2", shipmentIds: ["medium", "fourth"] },
      ],
    };
    expect(allocationSignature(reassigned)).not.toBe(allocationSignature(best));
    expect(logisticsComparison(source, best, [best, swappedNames])).toEqual({
      required: { assignment: true, sequence: true },
      observed: { assignment: false, sequence: false },
      missing: ["assignment", "sequence"],
      complete: false,
    });
    expect(
      logisticsComparison(
        source,
        candidate(["schedule", "medium", "high", "fourth"]),
        [],
      ),
    ).toEqual({
      required: { assignment: true, sequence: true },
      observed: { assignment: false, sequence: false },
      missing: ["assignment", "sequence"],
      complete: false,
    });
    expect(
      logisticsComparison(source, best, [best, reordered]).missing,
    ).toEqual(["assignment"]);
    expect(
      logisticsComparison(source, best, [best, reassigned]).missing,
    ).toEqual(["sequence"]);
    expect(
      logisticsComparison(source, best, [best, reassigned, reordered]).complete,
    ).toBe(true);
    // A new best allocation has not had its own order compared yet.
    expect(
      logisticsComparison(source, reassigned, [best, reassigned, reordered])
        .missing,
    ).toEqual(["sequence"]);
    const original = structuredClone(best);
    allocationSignature(best);
    expect(best).toEqual(original);
  });

  it("does not demand impossible sequence or allocation experiments, nor count repeated orders as destinations", () => {
    const source = board();
    source.vehicles.pop();
    const uniqueRanks = {
      routes: [candidate(["high", "medium", "schedule"]).routes[0]],
    };
    expect(logisticsComparison(source, uniqueRanks, [uniqueRanks])).toEqual({
      required: { assignment: false, sequence: false },
      observed: { assignment: false, sequence: false },
      missing: [],
      complete: true,
    });
    source.shipments = [
      source.shipments[2],
      { ...source.shipments[2], id: "high2" },
    ];
    const singleGroup = {
      routes: [{ vehicleId: "v1", shipmentIds: ["high", "high2"] }],
    };
    expect(
      logisticsComparison(source, singleGroup, [singleGroup]).required,
    ).toEqual({ assignment: false, sequence: false });
    source.vehicles = board().vehicles;
    singleGroup.routes.push({ vehicleId: "v2", shipmentIds: [] });
    expect(
      logisticsComparison(source, singleGroup, [singleGroup]).complete,
    ).toBe(true);
    source.shipments = [];
    expect(
      logisticsComparison(source, candidate([]), [candidate([])]).complete,
    ).toBe(true);
    const splitRanks = {
      routes: [
        { vehicleId: "v1", shipmentIds: ["high", "medium"] },
        { vehicleId: "v2", shipmentIds: ["schedule"] },
      ],
    };
    expect(
      logisticsComparison(board(), splitRanks, [splitRanks]).missing,
    ).toEqual(["assignment"]);
  });

  it("recognizes substantive alternatives and does not count renaming trucks", () => {
    const source = board();
    const a = candidate(["high", "medium", "schedule"]);
    const swap = {
      routes: [
        { vehicleId: "v2", shipmentIds: a.routes[0].shipmentIds },
        { vehicleId: "v1", shipmentIds: [] },
      ],
    };
    expect(logisticsSignature(a)).toBe(logisticsSignature(swap));
    expect(logisticsSignature(a)).toBe(
      logisticsSignature({ routes: [...a.routes].reverse() }),
    );
    const split = {
      routes: [
        { vehicleId: "v1", shipmentIds: ["high"] },
        { vehicleId: "v2", shipmentIds: ["medium", "schedule"] },
      ],
    };
    expect(logisticsSignature(a)).not.toBe(logisticsSignature(split));
    expect(logisticsSignature(a)).not.toBe(
      logisticsSignature(candidate(["medium", "high", "schedule"])),
    );
    expect(hasRoutingAlternatives(source)).toBe(true);
    const small = board();
    small.shipments = small.shipments.slice(0, 2);
    expect(hasRoutingAlternatives(small)).toBe(true);
    small.shipments.pop();
    expect(hasRoutingAlternatives(small)).toBe(false);
    small.shipments = [];
    expect(hasRoutingAlternatives(small)).toBe(false);
    source.vehicles.pop();
    expect(hasRoutingAlternatives(source)).toBe(false);
    source.shipments.push(shipment("high2", 4, "high"));
    expect(hasRoutingAlternatives(source)).toBe(true);
    source.shipments = [source.shipments[0]];
    expect(hasRoutingAlternatives(source)).toBe(false);
    source.shipments = [];
    expect(hasRoutingAlternatives(source)).toBe(false);
    const chosen = { id: "best" };
    expect(candidateCommitDecision(chosen, chosen, false)).toHaveProperty(
      "error",
    );
    expect(candidateCommitDecision(chosen, chosen, true)).toEqual({ chosen });
    expect(
      candidateCommitDecision(chosen, { id: "another" }, true),
    ).toHaveProperty("error");
  });

  it.each(logisticsScoreKeys)(
    "keeps %s above every later objective, regardless of its scale",
    (key) => {
      const zero = Object.fromEntries(
        logisticsScoreKeys.map((k) => [k, 0]),
      ) as LogisticsScore;
      const earlier = { ...zero, [key]: 1 };
      const later = { ...zero };
      for (const laterKey of logisticsScoreKeys.slice(
        logisticsScoreKeys.indexOf(key) + 1,
      ))
        later[laterKey] = 1e12;
      expect(compareLogisticsScores(earlier, later)).toBeGreaterThan(0);
      expect(compareLogisticsScores(later, earlier)).toBeLessThan(0);
      expect(compareLogisticsScores(zero, zero)).toBe(0);
    },
  );
});

describe("Google grouped seed / pure request and response mapping", () => {
  it("sends one stop per customer, expands every original ID and preserves distinct identities at the same coordinates", () => {
    const source = board();
    source.shipments.push(
      { ...source.shipments[2], id: "high2" },
      { ...source.shipments[0], id: "pickup", fulfillmentMode: "pickup" },
      { ...source.shipments[0], id: "archived", customerArchived: true },
    );
    const request = buildGoogleOptimizationRequest(source, settings, "UTC");
    expect(request.model.shipments.map((s) => s.label)).toEqual([
      "schedule",
      "medium",
      "high",
    ]);
    expect(request.model.shipments[0].deliveries[0]).not.toHaveProperty(
      "timeWindows",
    );
    const proposal = proposalCandidate(source, {
      routes: [
        {
          vehicleIndex: 0,
          visits: [{ shipmentIndex: 2 }, { shipmentIndex: 1 }],
        },
        { vehicleIndex: 1, visits: [{ shipmentIndex: 0 }] },
      ],
    } as Parameters<typeof proposalCandidate>[1]);
    expect(proposal.routes.map((r) => r.shipmentIds)).toEqual([
      ["high", "high2", "medium"],
      ["schedule"],
    ]);
    expect(parseCandidate(proposal, source)).toEqual(proposal);
  });

  it("sends a soft deadline envelope and does not exclude an already-late shipment", () => {
    const source = board();
    source.shipments[0].deliveryWindows = [
      { startMinute: 300, endMinute: 400 },
    ];
    source.shipments[1].deliveryWindows = [
      { startMinute: 600, endMinute: 660 },
      { startMinute: 900, endMinute: 960 },
    ];
    const request = buildGoogleOptimizationRequest(source, settings, "UTC");
    const lateWindow = request.model.shipments[0].deliveries[0].timeWindows![0];
    expect(lateWindow.startTime).toBe("2026-09-12T08:00:00.000Z");
    expect(lateWindow.softEndTime).toBe(lateWindow.startTime);
    expect(lateWindow.endTime).toBe(request.model.globalEndTime);
    expect(lateWindow.costPerHourAfterSoftEndTime).toBe(7200);
    const multiple = request.model.shipments[1].deliveries[0].timeWindows![0];
    expect(multiple.startTime).toBe("2026-09-12T10:00:00.000Z");
    expect(multiple.softEndTime).toBe("2026-09-12T16:00:00.000Z");
    expect(request.model.shipments[2].deliveries[0]).not.toHaveProperty(
      "timeWindows",
    );
  });
});
