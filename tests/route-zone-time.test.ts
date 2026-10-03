import { describe, expect, it } from "vitest";
import { geographicZones, zoneVehicleCosts } from "../src/core/route-zones";
import {
  buildDirectFleetRequest,
  assertDirectFleetResponse,
} from "../src/core/route-google-direct";
import { routeTimeConflicts } from "../src/core/route-time-conflicts";
import type { GoogleOptimizationResult } from "../src/core/route-optimization-google";
import type { PublicOptimization } from "../src/core/routing-contract";
import { zoneBoard, zoneSettings, zoneShipment } from "./helpers/zone-board";

// Pure mathematical/domain contracts, no HTTP interception or simulated solver.
describe("dynamic fleet and finite geographical preferences", () => {
  it.each([1, 4, 5, 6, 12])(
    "uses all %i plan vehicles without a fixed fleet or pinned orders",
    (count) => {
      const board = zoneBoard(
        Array.from({ length: 8 }, (_, i) =>
          zoneShipment(i, {
            longitude: -103.4 + i / 100,
            unloadingMinutes: i + 1,
            deliveryWindows: [{ startMinute: 480, endMinute: 600 + i }],
          }),
        ),
        count,
      );
      const original = structuredClone(board);
      const { request } = buildDirectFleetRequest(board, zoneSettings, "UTC");
      expect(request.model.vehicles).toHaveLength(count);
      for (const shipment of request.model.shipments) {
        expect(shipment.allowedVehicleIndices).toBeUndefined();
        expect(shipment.costsPerVehicle).toHaveLength(count);
        expect(
          shipment.costsPerVehicle!.every(
            (cost) => Number.isFinite(cost) && cost >= 0,
          ),
        ).toBe(true);
        expect(Math.min(...shipment.costsPerVehicle!)).toBe(0);
        expect(shipment).not.toHaveProperty("penaltyCost");
        expect(
          shipment.deliveries.find((v) => v.cost !== undefined)
            ?.timeWindows?.[0].costPerHourAfterSoftEndTime,
        ).toBeGreaterThan(0);
      }
      expect(
        request.model.vehicles.every(
          (v) => v.costPerHour === v.costPerTraveledHour && v.costPerHour! > 0,
        ),
      ).toBe(true);
      expect(
        request.model.shipments.map((s) => s.deliveries[0].duration),
      ).toEqual(Array.from({ length: 8 }, (_, i) => `${(i + 1) * 60}s`));
      expect(board).toEqual(original);
    },
  );
  it("prefers nearby centers, preserves physical weighting and vehicle identity under reorder", () => {
    const groups = [-103.5, -103.49, -103.31, -103.3].map((longitude, i) => ({
      latitude: 20.65,
      longitude,
      shipmentIds: [`s${i}`],
    }));
    const vehicles = ["west", "east"];
    const zones = geographicZones(
      groups,
      vehicles,
      zoneSettings.depotLocation!,
    );
    const costs = zoneVehicleCosts(groups, zones, vehicles);
    const reordered = zoneVehicleCosts(
      [...groups].reverse(),
      geographicZones(
        [...groups].reverse(),
        [...vehicles].reverse(),
        zoneSettings.depotLocation!,
      ),
      [...vehicles].reverse(),
    );
    for (const group of groups)
      expect(costs.get(group.shipmentIds[0])).toEqual(
        reordered.get(group.shipmentIds[0])!.toReversed(),
      );
    expect(costs.get("s0")![0]).toBe(0);
    expect(costs.get("s0")![1]).toBeGreaterThan(10);
    expect(costs.get("s3")![1]).toBe(0);
    const duplicate = { ...groups[0], shipmentIds: ["extra"] };
    expect(
      zoneVehicleCosts(
        [...groups, duplicate],
        geographicZones(
          [...groups, duplicate],
          vehicles,
          zoneSettings.depotLocation!,
        ),
        vehicles,
      ).get("s3"),
    ).toEqual(costs.get("s3"));
  });
  it("allows helper vehicles even when there are more trucks than locations", () => {
    const group = { latitude: 20.65, longitude: -103.4, shipmentIds: ["s"] };
    const vehicles = Array.from({ length: 6 }, (_, i) => `v${i}`);
    const zones = geographicZones(
      [group],
      vehicles,
      zoneSettings.depotLocation!,
    );
    expect(zoneVehicleCosts([group], zones, vehicles).get("s")).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
    expect(() => zoneVehicleCosts([group], zones, [])).toThrow(
      "ROUTING_VEHICLES_REQUIRED",
    );
    expect(() => zoneVehicleCosts([], { routes: [] }, vehicles)).toThrow(
      "ROUTING_ORDERS_REQUIRED",
    );
  });
  it("handles the date line, poles and antipodal centers without NaN", () => {
    for (const coordinates of [
      [
        [0, 179.99],
        [0, -179.99],
      ],
      [
        [90, 0],
        [-90, 0],
      ],
      [
        [0, 0],
        [0, 180],
      ],
    ]) {
      const groups = coordinates.map(([latitude, longitude], i) => ({
        latitude,
        longitude,
        shipmentIds: [`s${i}`],
      }));
      const zones = {
        routes: [
          { vehicleId: "v0", shipmentIds: ["s0", "s1"] },
          { vehicleId: "v1", shipmentIds: [] },
        ],
      };
      for (const costs of zoneVehicleCosts(groups, zones, [
        "v0",
        "v1",
      ]).values())
        expect(costs.every((cost) => Number.isFinite(cost) && cost >= 0)).toBe(
          true,
        );
    }
  });
  it("accepts a different plan truck but rejects invalid trucks, visits and prohibited eligibility", () => {
    const { request } = buildDirectFleetRequest(
      zoneBoard([zoneShipment(1)], 4),
      zoneSettings,
      "UTC",
    );
    const result = {
      routes: [
        {
          vehicleIndex: 3,
          visits: [{ shipmentIndex: 0, eta: "2026-10-02T08:00:00Z" }],
          finishedAt: "2026-10-02T08:01:00Z",
        },
      ],
    } as GoogleOptimizationResult;
    expect(() => assertDirectFleetResponse(request, result)).not.toThrow();
    for (const index of [-1, 4, 1.5, NaN]) {
      result.routes[0].vehicleIndex = index;
      expect(() => assertDirectFleetResponse(request, result)).toThrow(
        "ROUTING_RESPONSE_INVALID",
      );
    }
    result.routes[0].vehicleIndex = 3;
    result.routes[0].visits[0].shipmentIndex = 1;
    expect(() => assertDirectFleetResponse(request, result)).toThrow(
      "ROUTING_RESPONSE_INVALID",
    );
    result.routes[0].visits[0].shipmentIndex = 0;
    request.model.shipments[0].allowedVehicleIndices = [];
    expect(() => assertDirectFleetResponse(request, result)).not.toThrow();
    request.model.shipments[0].allowedVehicleIndices = [0];
    expect(() => assertDirectFleetResponse(request, result)).toThrow(
      "ROUTING_RESPONSE_INVALID",
    );
  });
});

describe("forecast conflicts use only the current map snapshot", () => {
  const board = zoneBoard(
    [
      zoneShipment(1, {
        deliveryWindows: [{ startMinute: 480, endMinute: 540 }],
      }),
      zoneShipment(2),
    ],
    2,
  );
  const metrics = {
    travelDistanceMeters: 0,
    travelDurationSeconds: 0,
    waitDurationSeconds: 0,
    totalDurationSeconds: 0,
    performedShipmentCount: 2,
  };
  const run: PublicOptimization = {
    runId: "run",
    planId: board.plan.id,
    appliedPlanVersion: board.plan.version,
    current: true,
    createdAt: "2026-10-02T00:00:00Z",
    metrics,
    skipped: [],
    routes: [
      {
        vehicleId: "v0",
        vehicleName: "Camioneta",
        encodedPolyline: null,
        metrics,
        stops: board.shipments.map((s, i) => ({
          shipmentId: s.id,
          position: i + 1,
          eta: "2026-10-02T09:00:01Z",
          travelDistanceMeters: 0,
          travelDurationSeconds: 0,
          waitDurationSeconds: 0,
          ...(i === 0 ? { lateSeconds: 61 } : {}),
        })),
      },
    ],
  };
  it("reports folio, truck, configured windows and rounded minutes and honors the truck filter", () => {
    expect(routeTimeConflicts(board, run)).toEqual([
      {
        shipmentId: "s1",
        customerName: "Cliente 1",
        orderName: "S1",
        vehicleName: "Camioneta",
        eta: "2026-10-02T09:00:01Z",
        lateMinutes: 2,
        windows: [{ startMinute: 480, endMinute: 540 }],
      },
    ]);
    expect(routeTimeConflicts(board, run, "v0")).toHaveLength(1);
    expect(routeTimeConflicts(board, run, "v1")).toEqual([]);
    expect(routeTimeConflicts(board, run, "unassigned")).toEqual([]);
    expect(routeTimeConflicts(board, null)).toEqual([]);
  });
  it("never mixes plans, versions or reassigned stops, and ignores nonpositive lateness", () => {
    for (const altered of [
      { ...run, current: false },
      { ...run, planId: "other" },
      { ...run, appliedPlanVersion: 2 },
    ])
      expect(routeTimeConflicts(board, altered)).toEqual([]);
    expect(
      routeTimeConflicts(
        { ...board, shipments: board.shipments.toReversed() },
        run,
      ),
    ).toEqual([]);
    for (const seconds of [0, -1]) {
      const onTime = structuredClone(run);
      onTime.routes[0].stops[0].lateSeconds = seconds;
      expect(routeTimeConflicts(board, onTime)).toEqual([]);
    }
  });
});
