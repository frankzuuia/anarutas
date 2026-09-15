import { describe, expect, it } from "vitest";
import type { OrderBoard, Shipment } from "../src/core/orders-contract";
import type { GoogleOptimizationResult } from "../src/core/route-optimization-google";
import { optimizationTimeoutSeconds } from "../src/core/route-optimization-google";
import type { RoutingSettings } from "../src/core/routing-contract";
import {
  buildDirectFleetRequest,
  directDeliveryGroups,
  directFleetDiagnostics,
  directFleetPolicy,
  expandDirectFleetResult,
} from "../src/core/route-google-direct";

const settings: RoutingSettings = {
  depotAddress: "QA",
  depotLocation: { latitude: 20.638586, longitude: -103.363893, placeId: null },
  version: 1,
  updatedAt: "2026-09-14T00:00:00Z",
};
function shipment(index: number): Shipment {
  return {
    id: `order-${index}`,
    pickingId: index,
    pickingName: String(index),
    orderId: index,
    orderName: String(index),
    partnerId: index,
    customerName: `Customer ${index}`,
    address: "unused by optimizer",
    validatedAt: null,
    promisedAt: null,
    backorderId: null,
    lines: [],
    vehicle_id: null,
    position: index,
    window_start: "08:00",
    window_end: "11:00",
    high_priority: index % 3 === 0,
    priority: (["high", "medium", "schedule"] as const)[index % 3],
    deliveryWindows: [{ startMinute: 480, endMinute: 660 }],
    deliveryNote: "",
    phone: null,
    fulfillmentMode: "delivery",
    mapUrl: null,
    latitude: 20.6 + index / 10000,
    longitude: -103.36,
    locationStatus: "confirmed",
    customerArchived: false,
  };
}
function board(orders = 3, vehicles = 2): OrderBoard {
  return {
    plan: {
      id: "qa-plan",
      version: 1,
      label: "QA",
      service_date: "2026-09-12",
      departure_minute: 420,
      updated_at: "2026-09-12T00:00:00Z",
    },
    vehicles: Array.from({ length: vehicles }, (_, i) => ({
      id: `vehicle-${i}`,
      name: `Vehicle ${i}`,
      brand: "QA",
      model: "QA",
      plate: `QA-${i}`,
      mileage: "0",
      fuel: "Gasolina",
      available: true,
      driver_id: null,
      driver_name: null,
      version: 1,
    })),
    shipments: Array.from({ length: orders }, (_, i) => shipment(i)),
  };
}

// Pure response-contract data, not a Google simulation or a live-route claim.
// The distance is the real aggregate in the reported 14-Sep regression. No
// external APIs, credentials, HTTP intercepts or solver calls occur here.
function response(sequence = [2, 0, 1]): GoogleOptimizationResult {
  const metrics = {
    travelDistanceMeters: 257632,
    travelDurationSeconds: 7200,
    waitDurationSeconds: 0,
    totalDurationSeconds: 7200,
    performedShipmentCount: sequence.length,
  };
  return {
    metrics,
    skipped: [],
    routes: [
      {
        vehicleIndex: 0,
        departureAt: "2026-09-12T07:00:00Z",
        finishedAt: "2026-09-12T09:00:00Z",
        encodedPolyline: "provider-route",
        metrics,
        visits: sequence.map((shipmentIndex, i) => ({
          shipmentIndex,
          eta: `2026-09-12T08:0${i}:00Z`,
          travelDistanceMeters: 1000 + i,
          travelDurationSeconds: 600 + i,
          waitDurationSeconds: 10 + i,
        })),
        transitions: [
          ...sequence.map((_, i) => ({
            encodedPolyline: `incoming-${i}`,
            routeToken: `private-${i}`,
          })),
          { encodedPolyline: "return-to-depot", routeToken: "private-return" },
        ],
      },
    ],
  };
}

describe("single global model, no paid calls", () => {
  it("pins the cost equations, coordinates, identifiers and priority tags of the one request", () => {
    expect(directFleetPolicy).toBe("google-direct-v1-priority-transitions");
    const current = board();
    const { request, groups } = buildDirectFleetRequest(
      current,
      settings,
      "UTC",
    );
    expect(request.model.shipments.map((s) => s.label)).toEqual(
      groups.map((g) => g.id),
    );
    expect(request.model.shipments.map((s) => s.deliveries[0].label)).toEqual(
      groups.map((g) => g.id),
    );
    expect(
      request.model.shipments.map((s) => s.deliveries[0].arrivalLocation),
    ).toEqual(
      current.shipments.map((s) => ({
        latitude: s.latitude,
        longitude: s.longitude,
      })),
    );
    expect(request.model.shipments.map((s) => s.deliveries[0].tags)).toEqual([
      ["priority:high"],
      ["priority:medium"],
      ["priority:schedule"],
    ]);
    expect(
      request.model.shipments.map(
        (s) => s.deliveries[0].timeWindows![0].costPerHourAfterSoftEndTime,
      ),
    ).toEqual([84, 56, 28]);
    expect(
      request.model.transitionAttributes!.map((edge) => edge.cost),
    ).toEqual([448, 896, 448]);
  });

  it("sorts windows canonically, including identical openings, and promotes the physical stop's highest priority", () => {
    const current = board(2);
    current.shipments[0].priority = "schedule";
    current.shipments[1].priority = "high";
    current.shipments.forEach((s) => {
      s.latitude = 20.65;
      s.deliveryWindows = [
        { startMinute: 600, endMinute: 800 },
        { startMinute: 480, endMinute: 600 },
        { startMinute: 480, endMinute: 540 },
      ];
    });
    current.shipments[1].deliveryWindows.reverse();
    const { groups } = buildDirectFleetRequest(current, settings, "UTC");
    expect(groups).toHaveLength(1);
    expect(groups[0].shipmentIds).toEqual(["order-1", "order-0"]);
    expect(groups[0].windows).toEqual([
      { startMinute: 480, endMinute: 540 },
      { startMinute: 480, endMinute: 600 },
      { startMinute: 600, endMinute: 800 },
    ]);
  });

  it("validates every coordinate component without coercing null to zero", () => {
    for (const field of ["latitude", "longitude"] as const) {
      for (const value of [null, NaN, Infinity, -Infinity, 181, -181]) {
        const current = board(1);
        current.shipments[0][field] = value;
        expect(() => directDeliveryGroups(current.shipments)).toThrow(
          "ROUTING_POINTS_REQUIRED",
        );
      }
    }
    for (const latitude of [-90, 0, 90])
      for (const longitude of [-180, 0, 180]) {
        const current = board(1);
        Object.assign(current.shipments[0], { latitude, longitude });
        expect(directDeliveryGroups(current.shipments)).toHaveLength(1);
      }
    const current = board(2);
    current.shipments[1].partnerId = 0;
    current.shipments[1].latitude = current.shipments[0].latitude;
    current.shipments[1].longitude = -103.37;
    expect(() => directDeliveryGroups(current.shipments)).toThrow(
      "ROUTING_POINTS_REQUIRED",
    );
  });
  it.each([
    [1, 1],
    [3, 7],
    [8, 2],
    [37, 3],
    [61, 4],
    [83, 5],
    [117, 6],
  ])(
    "uses the complete current batch of %i orders and %i vehicles",
    (orders, vehicles) => {
      const { request, groups } = buildDirectFleetRequest(
        board(orders, vehicles),
        settings,
        "UTC",
      );
      expect(groups).toHaveLength(orders);
      expect(request.model.shipments).toHaveLength(orders);
      expect(request.model.vehicles).toHaveLength(vehicles);
      expect(request.timeout).toBe(
        `${optimizationTimeoutSeconds(groups.length)}s`,
      );
      expect(request).not.toHaveProperty("injectedFirstSolutionRoutes");
      expect(request.model).not.toHaveProperty("precedenceRules");
      for (const item of request.model.shipments) {
        expect(item.loadDemands.destinations).toEqual({ amount: "1" });
        expect(item).not.toHaveProperty("penaltyCost");
        expect(item).not.toHaveProperty("allowedVehicleIndices");
      }
      for (const vehicle of request.model.vehicles) {
        expect(vehicle.loadLimits.orders).not.toHaveProperty("maxLoad");
        expect(vehicle.loadLimits.orders.softMaxLoad).toBe(
          String(Math.ceil(orders / vehicles)),
        );
        expect(vehicle.loadLimits.destinations.softMaxLoad).toBe(
          String(Math.ceil(orders / vehicles)),
        );
        expect(vehicle.endLocation).toEqual(vehicle.startLocation);
      }
      expect(request.populatePolylines).toBe(true);
      expect(request.populateTransitionPolylines).toBe(true);
    },
  );

  it("expresses every upward priority transition within the model, not N-squared precedence rules", () => {
    const { request } = buildDirectFleetRequest(board(), settings, "UTC");
    expect(
      request.model.transitionAttributes?.map(({ srcTag, dstTag }) => [
        srcTag,
        dstTag,
      ]),
    ).toEqual([
      ["priority:medium", "priority:high"],
      ["priority:schedule", "priority:high"],
      ["priority:schedule", "priority:medium"],
    ]);
    const largestLateCost = Math.max(
      ...request.model.shipments.map(
        (s) => s.deliveries[0].timeWindows![0].costPerHourAfterSoftEndTime!,
      ),
    );
    for (const edge of request.model.transitionAttributes!) {
      expect(Number.isFinite(edge.cost)).toBe(true);
      expect(edge.cost).toBeGreaterThan(largestLateCost);
    }
    const singleTier = board();
    singleTier.shipments.forEach((s) => {
      s.priority = "high";
    });
    expect(
      buildDirectFleetRequest(singleTier, settings, "UTC").request.model
        .transitionAttributes,
    ).toEqual([]);
  });

  it("does not base logistics on names, textual addresses, positions or current truck assignments", () => {
    const current = board();
    const initial = buildDirectFleetRequest(current, settings, "UTC");
    current.shipments.forEach((s, i) => {
      s.customerName = `Renamed ${i}`;
      s.address = "different billing address";
      s.position = 1000 - i;
      s.vehicle_id = current.vehicles[0].id;
    });
    expect(buildDirectFleetRequest(current, settings, "UTC")).toEqual(initial);
  });

  it("keeps distinct clients and near points distinct; merges only exact coordinates and identical windows", () => {
    const current = board(4, 3);
    current.shipments[1].latitude = current.shipments[0].latitude;
    current.shipments[2].latitude = current.shipments[0].latitude;
    current.shipments[2].deliveryWindows = [
      { startMinute: 720, endMinute: 780 },
    ];
    const { groups, request } = buildDirectFleetRequest(
      current,
      settings,
      "UTC",
    );
    expect(groups).toHaveLength(3);
    const grouped = groups.find((g) => g.shipmentIds.includes("order-1"))!;
    expect(grouped.shipmentIds).toEqual(["order-0", "order-1"]);
    expect(grouped.rank).toBe(0);
    expect(
      request.model.shipments.find((s) => s.label === grouped.id)?.loadDemands
        .orders.amount,
    ).toBe("2");
    expect(request.model.vehicles[0].loadLimits.destinations.softMaxLoad).toBe(
      "1",
    );
    expect(current.shipments.map((s) => s.partnerId)).toEqual([0, 1, 2, 3]);
  });

  it("keeps every order of the same shipping contact contiguous even with mixed priorities", () => {
    const current = board(3, 2);
    current.shipments[2].partnerId = current.shipments[0].partnerId;
    current.shipments[2].latitude = current.shipments[0].latitude;
    const { groups } = buildDirectFleetRequest(current, settings, "UTC");
    expect(groups).toHaveLength(2);
    const expanded = expandDirectFleetResult(
      current,
      groups,
      response([1, 0]),
      "UTC",
    );
    expect(
      expanded.routes[0].visits.map(
        (v) => current.shipments[v.shipmentIndex].id,
      ),
    ).toEqual(["order-1", "order-0", "order-2"]);
  });

  it("models separate windows as alternatives, including past dates and a late departure", () => {
    const current = board(1, 1);
    current.shipments[0].deliveryWindows = [
      { startMinute: 480, endMinute: 600 },
      { startMinute: 720, endMinute: 840 },
      { startMinute: 480, endMinute: 600 },
    ];
    const { request } = buildDirectFleetRequest(current, settings, "UTC");
    const choices = request.model.shipments[0].deliveries;
    expect(choices).toHaveLength(2);
    expect(choices.map((v) => v.timeWindows![0].softEndTime)).toEqual([
      "2026-09-12T10:00:00.000Z",
      "2026-09-12T14:00:00.000Z",
    ]);
    expect(choices.every((v) => v.timeWindows!.length === 1)).toBe(true);
    current.plan.departure_minute = 1439;
    const late = buildDirectFleetRequest(current, settings, "UTC").request;
    expect(late.model.shipments).toHaveLength(1);
    for (const choice of late.model.shipments[0].deliveries) {
      const window = choice.timeWindows![0];
      expect(window.startTime).toBe(late.model.globalStartTime);
      expect(window.softEndTime).toBe(late.model.globalStartTime);
      expect(Date.parse(window.endTime)).toBeGreaterThan(
        Date.parse(window.softEndTime!),
      );
    }
    current.shipments[0].deliveryWindows = [];
    expect(
      buildDirectFleetRequest(current, settings, "UTC").request.model
        .shipments[0].deliveries[0],
    ).not.toHaveProperty("timeWindows");
  });

  it.each([null, NaN, Infinity, 91, -91])(
    "rejects invalid coordinates before any request: %s",
    (value) => {
      const current = board();
      current.shipments[0].latitude = value;
      expect(() => buildDirectFleetRequest(current, settings, "UTC")).toThrow(
        "ROUTING_POINTS_REQUIRED",
      );
    },
  );
  it("rejects unconfirmed or inconsistent coordinates for one contact", () => {
    const current = board();
    current.shipments[0].locationStatus = "pending";
    expect(() => directDeliveryGroups(current.shipments)).toThrow(
      "ROUTING_POINTS_REQUIRED",
    );
    current.shipments[0].locationStatus = "confirmed";
    current.shipments[1].partnerId = current.shipments[0].partnerId;
    expect(() => directDeliveryGroups(current.shipments)).toThrow(
      "ROUTING_POINTS_REQUIRED",
    );
    current.shipments[1].partnerId = 1;
    current.shipments[0].longitude = 181;
    expect(() => directDeliveryGroups(current.shipments)).toThrow(
      "ROUTING_POINTS_REQUIRED",
    );
  });
});

describe("provider result is authoritative, adaptation is pure", () => {
  it("accepts equal timestamps and finish boundaries, with optional vehicle times", () => {
    const current = board();
    current.shipments.forEach((s) => {
      s.priority = "high";
    });
    const raw = response([0, 1, 2]);
    raw.routes[0].visits.forEach((v) => {
      v.eta = "2026-09-12T09:00:00Z";
    });
    const groups = directDeliveryGroups(current.shipments);
    const equal = expandDirectFleetResult(current, groups, raw, "UTC");
    expect(
      equal.routes[0].visits.every((v) => v.priorityConflict === false),
    ).toBe(true);
    delete raw.routes[0].departureAt;
    delete raw.routes[0].finishedAt;
    expect(
      expandDirectFleetResult(current, groups, raw, "UTC").metrics,
    ).toEqual(raw.metrics);
    raw.routes[0].departureAt = "2026-09-12T10:00:00Z";
    expect(() => expandDirectFleetResult(current, groups, raw, "UTC")).toThrow(
      "ROUTING_RESPONSE_INVALID",
    );
    raw.routes[0].departureAt = "2026-09-12T07:00:00Z";
    raw.routes[0].finishedAt = "2026-09-12T08:30:00Z";
    expect(() => expandDirectFleetResult(current, groups, raw, "UTC")).toThrow(
      "ROUTING_RESPONSE_INVALID",
    );
  });

  it("independently rejects duplicate vehicles even when their orders are disjoint", () => {
    const current = board();
    const raw = response([0, 1]);
    const other = response([2]).routes[0];
    raw.routes.push(other);
    expect(() =>
      expandDirectFleetResult(
        current,
        directDeliveryGroups(current.shipments),
        raw,
        "UTC",
      ),
    ).toThrow("ROUTING_RESPONSE_INVALID");
  });

  it("retains the customer-contiguity guard even if an internal grouping contract is corrupted", () => {
    const current = board();
    current.shipments[2].partnerId = 0;
    current.shipments[2].latitude = current.shipments[0].latitude;
    const groups = directDeliveryGroups(current.shipments);
    const corrupt = [
      { ...groups[0], shipmentIds: ["order-0"] },
      groups[1],
      { ...groups[0], shipmentIds: ["order-2"] },
    ];
    expect(() =>
      expandDirectFleetResult(current, corrupt, response([0, 1, 2]), "UTC"),
    ).toThrow("ROUTING_CUSTOMER_GROUP_INVALID");
  });

  it("retains distinct return-leg and missing-coverage error contracts", () => {
    const current = board();
    const groups = directDeliveryGroups(current.shipments);
    const badReturn = response();
    badReturn.routes[0].transitions.pop();
    expect(() =>
      expandDirectFleetResult(current, groups, badReturn, "UTC"),
    ).toThrowError(
      expect.objectContaining({ details: { field: "route.returnTransition" } }),
    );
    expect(() =>
      expandDirectFleetResult(current, groups, response([0, 1]), "UTC"),
    ).toThrowError(
      expect.objectContaining({
        details: { field: "shipments.completeCoverage" },
      }),
    );
  });

  it("preserves exact diagnostics, excludes ineligible rows and counts empty routes truthfully", () => {
    const current = board(5, 3);
    current.shipments[0].fulfillmentMode = "pickup";
    current.shipments[1].customerArchived = true;
    const groups = directDeliveryGroups(current.shipments);
    const raw = response([0, 1, 2]);
    raw.routes[0].finishedAt = "2026-09-12T13:00:00Z";
    raw.routes[0].visits.forEach((visit) => {
      visit.eta = "2026-09-12T12:00:00Z";
    });
    const expanded = expandDirectFleetResult(current, groups, raw, "UTC");
    expect(directFleetDiagnostics(current, expanded)).toEqual({
      ordersPerRoute: [3, 0, 0],
      destinationsPerRoute: [3, 0, 0],
      lateStops: 3,
      lateSeconds: 10800,
      priorityConflicts: 0,
      unusedVehicles: 2,
      operationalSeconds: 14400,
      travelSeconds: 7200,
      makespanSeconds: 7200,
      distanceMeters: 257632,
      maxOrders: 3,
      orderImbalance: 3,
    });
    expanded.routes[0].visits.forEach((visit) => {
      delete visit.lateSeconds;
    });
    expect(directFleetDiagnostics(current, expanded).lateSeconds).toBe(0);
    expect(directFleetDiagnostics(current, expanded).lateStops).toBe(0);
  });
  it("regresses the 257632m response overwritten by a 442329m alternative", () => {
    const current = board();
    const groups = directDeliveryGroups(current.shipments);
    const incoming = response();
    const unchanged = structuredClone(incoming);
    const expanded = expandDirectFleetResult(current, groups, incoming, "UTC");
    expect(expanded.metrics.travelDistanceMeters).toBe(257632);
    expect(expanded.routes[0].visits.map((v) => v.shipmentIndex)).toEqual([
      2, 0, 1,
    ]);
    expect(expanded.routes[0].visits.map((v) => v.eta)).toEqual(
      incoming.routes[0].visits.map((v) => v.eta),
    );
    expect(expanded.routes[0].encodedPolyline).toBe(
      incoming.routes[0].encodedPolyline,
    );
    expect(expanded.routes[0].transitions).toEqual(
      incoming.routes[0].transitions,
    );
    expect(expanded.metrics).toEqual(incoming.metrics);
    expect(directFleetDiagnostics(current, expanded)).toMatchObject({
      priorityConflicts: 2,
      distanceMeters: 257632,
      ordersPerRoute: [3, 0],
      unusedVehicles: 1,
    });
    expect(incoming).toEqual(unchanged);
  });

  it("expands physical visits without double-counting travel/wait/distance or losing the return leg", () => {
    const current = board(2);
    current.shipments[1].latitude = current.shipments[0].latitude;
    const raw = response([0]);
    const expanded = expandDirectFleetResult(
      current,
      directDeliveryGroups(current.shipments),
      raw,
      "UTC",
    );
    expect(expanded.metrics).toEqual({
      ...raw.metrics,
      performedShipmentCount: 2,
    });
    expect(expanded.routes[0].metrics).toEqual({
      ...raw.routes[0].metrics,
      performedShipmentCount: 2,
    });
    expect(expanded.routes[0].visits[1]).toMatchObject({
      shipmentIndex: 1,
      eta: raw.routes[0].visits[0].eta,
      travelDistanceMeters: 0,
      travelDurationSeconds: 0,
      waitDurationSeconds: 0,
    });
    expect(expanded.routes[0].visits[0]).toMatchObject(raw.routes[0].visits[0]);
    expect(expanded.routes[0].transitions).toEqual([
      raw.routes[0].transitions[0],
      { encodedPolyline: null, routeToken: null },
      raw.routes[0].transitions[1],
    ]);
  });

  it("keeps actual planned lateness and does not confuse between-window arrivals with on-time", () => {
    const current = board(1, 1);
    current.shipments[0].deliveryWindows = [
      { startMinute: 480, endMinute: 500 },
      { startMinute: 600, endMinute: 660 },
    ];
    const raw = response([0]);
    raw.routes[0].finishedAt = "2026-09-12T12:00:00Z";
    for (const [eta, expected] of [
      ["08:00", 0],
      ["08:20", 0],
      ["10:00", 0],
      ["10:30", 0],
      ["11:00", 0],
      ["07:30", 0],
      ["08:40", 1200],
      ["11:30", 1800],
    ] as const) {
      raw.routes[0].visits[0].eta = `2026-09-12T${eta}:00Z`;
      const expanded = expandDirectFleetResult(
        current,
        directDeliveryGroups(current.shipments),
        raw,
        "UTC",
      );
      expect(expanded.routes[0].visits[0].lateSeconds).toBe(expected);
      expect(directFleetDiagnostics(current, expanded).lateStops).toBe(
        Number(expected > 0),
      );
    }
    current.shipments[0].deliveryWindows = [];
    expect(
      expandDirectFleetResult(
        current,
        directDeliveryGroups(current.shipments),
        raw,
        "UTC",
      ).routes[0].visits[0].lateSeconds,
    ).toBe(0);
  });

  it.each([
    "skipped",
    "duplicate",
    "unknown",
    "missing",
    "vehicle",
    "duplicateVehicle",
    "return",
    "backwards",
    "afterFinish",
    "invalidTime",
  ])("rejects corrupt response without partially saving: %s", (kind) => {
    const current = board();
    const raw = response();
    if (kind === "skipped")
      raw.skipped.push({ shipmentIndex: 0, reasons: ["NO_VEHICLE"] });
    if (kind === "duplicate") raw.routes[0].visits[1].shipmentIndex = 2;
    if (kind === "unknown") raw.routes[0].visits[0].shipmentIndex = 999;
    if (kind === "missing") {
      raw.routes[0].visits.pop();
      raw.routes[0].transitions.pop();
    }
    if (kind === "vehicle") raw.routes[0].vehicleIndex = 999;
    if (kind === "duplicateVehicle")
      raw.routes.push(structuredClone(raw.routes[0]));
    if (kind === "return") raw.routes[0].transitions.pop();
    if (kind === "backwards")
      raw.routes[0].visits[1].eta = "2026-09-12T07:50:00Z";
    if (kind === "afterFinish")
      raw.routes[0].visits[1].eta = "2026-09-12T10:00:00Z";
    if (kind === "invalidTime") raw.routes[0].visits[0].eta = "invalid";
    expect(() =>
      expandDirectFleetResult(
        current,
        directDeliveryGroups(current.shipments),
        raw,
        "UTC",
      ),
    ).toThrow("ROUTING_RESPONSE_INVALID");
  });

  it("excludes pickup/archived orders and accepts more vehicles than deliveries", () => {
    const current = board(3, 7);
    current.shipments[1].customerArchived = true;
    current.shipments[2].fulfillmentMode = "pickup";
    const raw = response([0]);
    raw.routes.push({
      vehicleIndex: 1,
      encodedPolyline: null,
      metrics: {
        travelDistanceMeters: 0,
        travelDurationSeconds: 0,
        waitDurationSeconds: 0,
        totalDurationSeconds: 0,
        performedShipmentCount: 0,
      },
      visits: [],
      transitions: [],
    });
    const expanded = expandDirectFleetResult(
      current,
      directDeliveryGroups(current.shipments),
      raw,
      "UTC",
    );
    expect(expanded.metrics.performedShipmentCount).toBe(1);
    expect(expanded.routes[1].transitions).toEqual([]);
    expect(directFleetDiagnostics(current, expanded).ordersPerRoute).toEqual([
      1, 0, 0, 0, 0, 0, 0,
    ]);
    const missingGroup = directDeliveryGroups(current.shipments);
    missingGroup[0].shipmentIds.push("not-in-board");
    expect(() =>
      expandDirectFleetResult(current, missingGroup, raw, "UTC"),
    ).toThrow("ROUTING_RESPONSE_INVALID");
  });
});
