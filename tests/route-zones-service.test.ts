import { describe, expect, it } from "vitest";
import {
  geographicZones,
  zoneVehicleIndices,
  repairEmptyZones,
} from "../src/core/route-zones";
import {
  buildDirectFleetRequest,
  assertDirectFleetResponse,
} from "../src/core/route-google-direct";
import { calculateManualRoutes } from "../src/core/route-road";
import {
  consecutiveServiceSeconds,
  maximumUnloadingMinutes,
  unloadingMinutesInput,
  visitServiceSeconds,
} from "../src/core/route-service-time";
import {
  routeFingerprint,
  vehicleRouteFingerprints,
} from "../src/core/route-fingerprint";
import { zoneBoard, zoneShipment, zoneSettings } from "./helpers/zone-board";
import type { GoogleOptimizationResult } from "../src/core/route-optimization-google";

describe("zones — deterministic domain computation, no remote substitutes", () => {
  it("recovers empty zones without dropping destinations or emptying singleton zones", () => {
    const assignments = [0, 0, 0, 0, 0];
    const vectors = [
      [0, 0, 0],
      [2, 0, 0],
      [4, 0, 0],
      [1, 0, 0],
      [3, 0, 0],
    ];
    expect(
      repairEmptyZones(assignments, vectors, [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ).toEqual([3, 1, 1]);
    expect(assignments).toEqual([0, 0, 1, 0, 2]);
  });
  const depot = zoneSettings.depotLocation!;
  const groups = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({
    latitude: 20.65 + i / 100000,
    longitude: i < 8 ? -103.5 : -103.3,
    shipmentIds: [`s${i}`],
  }));
  it("keeps uneven nearby destinations together instead of forcing a five/five split", () => {
    const candidate = geographicZones(groups, ["b", "a"], depot);
    const ids = zoneVehicleIndices(candidate, ["b", "a"]);
    expect(
      new Set(groups.slice(0, 8).map((g) => ids.get(g.shipmentIds[0]))).size,
    ).toBe(1);
    expect(ids.get("s8")).toBe(ids.get("s9"));
    expect(ids.get("s8")).not.toBe(ids.get("s0"));
    expect(
      candidate.routes.map((r) => r.shipmentIds.length).sort((a, b) => a - b),
    ).toEqual([2, 8]);
    expect(new Set(candidate.routes.flatMap((r) => r.shipmentIds)).size).toBe(
      10,
    );
    expect(geographicZones([...groups].reverse(), ["a", "b"], depot)).toEqual(
      candidate,
    );
  });
  it("keeps three separated neighborhoods compact rather than oscillating toward the farthest center", () => {
    const neighborhoods = [
      [20.6, -103.6],
      [20.6, -103.2],
      [20.9, -103.4],
    ];
    const points = neighborhoods.flatMap(([latitude, longitude], zone) =>
      Array.from({ length: 6 }, (_, i) => ({
        latitude: latitude + i / 10000,
        longitude: longitude + (i % 2) / 10000,
        shipmentIds: [`${zone}:${i}`],
      })),
    );
    const result = geographicZones(points, ["a", "b", "c"], depot);
    expect(result.routes.map((r) => r.shipmentIds.length)).toEqual([6, 6, 6]);
    for (const route of result.routes)
      expect(
        new Set(route.shipmentIds.map((id) => id.split(":")[0])).size,
      ).toBe(1);
  });
  it("uses one truck per distinct zone, keeps co-located clients together and covers empty/single fleets", () => {
    const input = [...groups, { ...groups[0], shipmentIds: ["duplicate"] }];
    const candidate = geographicZones(
      input,
      Array.from({ length: 12 }, (_, i) => `v${i}`),
      depot,
    );
    expect(candidate.routes.filter((r) => r.shipmentIds.length)).toHaveLength(
      10,
    );
    expect(
      candidate.routes.find((r) => r.shipmentIds.includes("s0"))!.shipmentIds,
    ).toContain("duplicate");
    expect(
      geographicZones(groups, ["a"], depot).routes[0].shipmentIds,
    ).toHaveLength(10);
    expect(geographicZones([], ["a"], depot).routes).toEqual([
      { vehicleId: "a", shipmentIds: [] },
    ]);
    expect(() => geographicZones(groups, [], depot)).toThrow(
      "ROUTING_VEHICLES_REQUIRED",
    );
    for (const point of [
      { latitude: NaN, longitude: 0 },
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: Infinity },
      { latitude: 0, longitude: 181 },
    ])
      expect(() =>
        geographicZones([{ ...point, shipmentIds: ["x"] }], ["a"], depot),
      ).toThrow("ROUTING_POINTS_REQUIRED");
  });
  it("handles longitude wrap and many differently sized fleets without dropping orders", () => {
    const points = Array.from({ length: 120 }, (_, i) => ({
      latitude: 20 + (i % 12) / 100,
      longitude: -103 + Math.floor(i / 12) / 100,
      shipmentIds: [String(i)],
    }));
    for (const count of [1, 2, 3, 7, 20, 125]) {
      const result = geographicZones(
        points,
        Array.from({ length: count }, (_, i) => String(i)),
        depot,
      );
      expect(result.routes.filter((r) => r.shipmentIds.length)).toHaveLength(
        Math.min(count, 120),
      );
      expect(new Set(result.routes.flatMap((r) => r.shipmentIds)).size).toBe(
        120,
      );
    }
    const wrap = geographicZones(
      [
        { latitude: 0, longitude: 179.9, shipmentIds: ["a"] },
        { latitude: 0, longitude: -179.9, shipmentIds: ["b"] },
        { latitude: 0, longitude: 0, shipmentIds: ["c"] },
      ],
      ["1", "2"],
      { latitude: 0, longitude: 90 },
    );
    expect(
      wrap.routes.find((r) => r.shipmentIds.includes("a"))!.shipmentIds,
    ).toContain("b");
  });
});

describe("unloading contracts and clocks", () => {
  it("validates integers, preserves omission/null and rejects invalid minutes", () => {
    for (const value of [undefined, null, 0, 15, maximumUnloadingMinutes])
      expect(unloadingMinutesInput(value)).toBe(value);
    for (const value of [
      -1,
      1.5,
      NaN,
      Infinity,
      "15",
      {},
      maximumUnloadingMinutes + 1,
    ])
      expect(() => unloadingMinutesInput(value)).toThrow("INVALID_INPUT");
    expect(visitServiceSeconds([])).toBe(0);
    expect(
      visitServiceSeconds([
        { partnerId: 1, unloadingMinutes: 15 },
        { partnerId: 1, unloadingMinutes: 15 },
        { partnerId: 2, unloadingMinutes: 5 },
        { partnerId: 3 },
      ]),
    ).toBe(1200);
  });
  it("sends zones and exact service duration on every Google window alternative", () => {
    const a = zoneShipment(1, {
        unloadingMinutes: 15,
        deliveryWindows: [
          { startMinute: 480, endMinute: 600 },
          { startMinute: 700, endMinute: 900 },
        ],
      }),
      b = zoneShipment(2, { ...a, id: "s2" }),
      c = zoneShipment(3, {
        unloadingMinutes: 5,
        deliveryWindows: [...a.deliveryWindows].reverse(),
      }),
      d = zoneShipment(4, { longitude: -103.2, unloadingMinutes: 8 });
    const { request, groups, zones } = buildDirectFleetRequest(
      zoneBoard([a, b, c, d]),
      zoneSettings,
      "UTC",
    );
    expect(groups).toHaveLength(2);
    expect(
      request.model.shipments[0].deliveries.map((v) => v.duration),
    ).toEqual(["1200s", "1200s"]);
    expect(request.model.shipments[1].deliveries[0].duration).toBe("480s");
    expect(
      request.model.shipments.every(
        (s) => s.allowedVehicleIndices === undefined,
      ),
    ).toBe(true);
    expect(
      request.model.shipments.map((s) => s.costsPerVehicle?.length),
    ).toEqual([2, 2]);
    expect(zones.routes.flatMap((r) => r.shipmentIds).sort()).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
    ]);
  });
  it("manual recalc adds service and waiting to ETAs and depot return, no network for co-located points", async () => {
    const shipments = [
      zoneShipment(1, { unloadingMinutes: 15 }),
      zoneShipment(2, { partnerId: 1, unloadingMinutes: 15 }),
      zoneShipment(3, { unloadingMinutes: 5 }),
      zoneShipment(4, {
        unloadingMinutes: 7,
        deliveryWindows: [{ startMinute: 540, endMinute: 600 }],
      }),
    ];
    expect([...consecutiveServiceSeconds(shipments)]).toEqual([
      ["s3", 1200],
      ["s4", 420],
    ]);
    const result = await calculateManualRoutes(
      zoneBoard(shipments, 1),
      zoneSettings,
      "UTC",
    );
    const route = result.routes[0];
    expect(route.stops.map((s) => s.eta)).toEqual([
      "2026-10-02T08:00:00.000Z",
      "2026-10-02T08:00:00.000Z",
      "2026-10-02T08:00:00.000Z",
      "2026-10-02T09:00:00.000Z",
    ]);
    expect(route.finishedAt).toBe("2026-10-02T09:07:00.000Z");
    expect(route.metrics).toMatchObject({
      travelDurationSeconds: 0,
      waitDurationSeconds: 2400,
      totalDurationSeconds: 4020,
    });
    expect(
      consecutiveServiceSeconds([
        shipments[0],
        shipments[3],
        { ...shipments[0], id: "return" },
      ]).get("return"),
    ).toBe(900);
  });
  it("invalidates only affected truck hashes, preserving legacy null/zero hashes", () => {
    const current = zoneBoard([
      zoneShipment(1),
      zoneShipment(2, { vehicle_id: "v1" }),
    ]);
    const original = routeFingerprint(current, 1),
      hashes = vehicleRouteFingerprints(current, 1);
    current.shipments[0].unloadingMinutes = 0;
    expect(routeFingerprint(current, 1)).toBe(original);
    current.shipments[0].unloadingMinutes = 15;
    expect(routeFingerprint(current, 1)).not.toBe(original);
    const updated = vehicleRouteFingerprints(current, 1);
    expect(updated.v0).not.toBe(hashes.v0);
    expect(updated.v1).toBe(hashes.v1);
  });
  it("rejects provider contracts that violate zones or omit time at the final stop", () => {
    const { request } = buildDirectFleetRequest(
      zoneBoard([zoneShipment(1, { unloadingMinutes: 15 })], 1),
      zoneSettings,
      "UTC",
    );
    const result = {
      routes: [
        {
          vehicleIndex: 0,
          finishedAt: "2026-10-02T08:15:00Z",
          visits: [{ shipmentIndex: 0, eta: "2026-10-02T08:00:00Z" }],
        },
      ],
    } as GoogleOptimizationResult;
    expect(() => assertDirectFleetResponse(request, result)).not.toThrow();
    result.routes[0].vehicleIndex = 1;
    expect(() => assertDirectFleetResponse(request, result)).toThrow(
      "ROUTING_RESPONSE_INVALID",
    );
    result.routes[0].vehicleIndex = 0;
    result.routes[0].finishedAt = "2026-10-02T08:14:59Z";
    expect(() => assertDirectFleetResponse(request, result)).toThrow(
      "ROUTING_RESPONSE_INVALID",
    );
  });
});
