import { describe, expect, it } from "vitest";
import {
  buildDirectFleetRequest,
  assertDirectFleetResponse,
} from "../src/core/route-google-direct";
import { zoneBoard, zoneSettings, zoneShipment } from "./helpers/zone-board";
import {
  assertFleetBusinessConstraints,
  bindPhysicalPointOwners,
  strictPriorityTransitions,
} from "../src/core/route-fleet-constraints";
import type { GoogleOptimizationResult } from "../src/core/route-optimization-google";

// Pure request contracts. These assertions neither replace a provider nor
// claim that the resulting routes were executed by Google.
describe("joint fleet allocation and strict priority", () => {
  it("presents a shared point's actual priority visits to Google, with their own service and closing", () => {
    const current = zoneBoard([
      zoneShipment(1, {
        priority: "high",
        unloadingMinutes: 10,
        deliveryWindows: [{ startMinute: 480, endMinute: 600 }],
      }),
      zoneShipment(2, {
        unloadingMinutes: 15,
        deliveryWindows: [{ startMinute: 720, endMinute: 780 }],
      }),
      zoneShipment(3, { priority: "high", latitude: 20.66 }),
    ]);
    const { request, groups } = buildDirectFleetRequest(
      current,
      zoneSettings,
      "UTC",
    );
    expect(groups.map((g) => g.shipmentIds)).toEqual([["s1"], ["s3"], ["s2"]]);
    expect(groups.map((g) => g.rank)).toEqual([0, 0, 2]);
    expect(
      request.model.shipments.map((s) => s.deliveries[0].duration),
    ).toEqual(["600s", "0s", "900s"]);
    expect(
      request.model.shipments.map(
        (s) => s.deliveries[0].timeWindows?.[0].endTime,
      ),
    ).toEqual([
      "2026-10-02T10:00:00.000Z",
      undefined,
      "2026-10-02T13:00:00.000Z",
    ]);
  });

  it("makes a priority descent exceed the complete routing horizon, instead of just charging it", () => {
    const current = zoneBoard([
      zoneShipment(1, { priority: "high" }),
      zoneShipment(2, { priority: "medium", latitude: 20.66 }),
      zoneShipment(3, { latitude: 20.67 }),
    ]);
    const { request } = buildDirectFleetRequest(current, zoneSettings, "UTC");
    const span = Number(
      request.model.vehicles[0].routeDurationLimit!.maxDuration.slice(0, -1),
    );
    expect(request.model.transitionAttributes).toEqual([
      {
        srcTag: "priority:medium",
        dstTag: "priority:high",
        delay: `${span + 1}s`,
      },
      {
        srcTag: "priority:schedule",
        dstTag: "priority:high",
        delay: `${span + 1}s`,
      },
      {
        srcTag: "priority:schedule",
        dstTag: "priority:medium",
        delay: `${span + 1}s`,
      },
    ]);
    expect(
      (Date.parse(request.model.globalEndTime) -
        Date.parse(request.model.globalStartTime)) /
        1000,
    ).toBe(span + 1);
    expect(
      request.model.vehicles.every(
        (v) => v.routeDurationLimit!.maxDuration === `${span}s`,
      ),
    ).toBe(true);
    expect(
      request.model.shipments[0].deliveries[0].timeWindows?.[0].endTime,
    ).toBeUndefined();
  });

  it.each([1, 4, 5, 6, 12])(
    "keeps an exact point on one freely chosen vehicle among %i",
    (count) => {
      const current = zoneBoard(
        [
          zoneShipment(1, { priority: "high" }),
          zoneShipment(2, { priority: "medium" }),
          zoneShipment(3),
          zoneShipment(4, { priority: "medium", latitude: 20.66 }),
          zoneShipment(5, { latitude: 20.66 }),
          zoneShipment(6, { latitude: 20.67 }),
        ],
        count,
      );
      const original = structuredClone(current);
      const { request, groups } = buildDirectFleetRequest(
        current,
        zoneSettings,
        "UTC",
      );
      const types = request.model.shipments.map((s) => s.shipmentType);
      expect(types).toEqual([
        "point-owner:0",
        "point-member:0",
        "point-owner:2",
        "point-member:0",
        "point-member:2",
        undefined,
      ]);
      expect(request.model.shipmentTypeRequirements).toEqual([
        {
          requiredShipmentTypeAlternatives: ["point-owner:0"],
          dependentShipmentTypes: ["point-member:0"],
          requirementMode: "PERFORMED_BY_SAME_VEHICLE",
        },
        {
          requiredShipmentTypeAlternatives: ["point-owner:2"],
          dependentShipmentTypes: ["point-member:2"],
          requirementMode: "PERFORMED_BY_SAME_VEHICLE",
        },
      ]);
      for (const requirement of request.model.shipmentTypeRequirements!) {
        expect(
          types.filter((t) =>
            requirement.requiredShipmentTypeAlternatives.includes(t!),
          ),
        ).toHaveLength(1);
        expect(
          requirement.dependentShipmentTypes.some((t) =>
            requirement.requiredShipmentTypeAlternatives.includes(t),
          ),
        ).toBe(false);
      }
      expect(
        request.model.shipments.every(
          (s) => s.allowedVehicleIndices === undefined,
        ),
      ).toBe(true);
      expect(request.model.vehicles).toHaveLength(count);
      expect(request.model.shipments[0].costsPerVehicle).toEqual(
        request.model.shipments[1].costsPerVehicle,
      );
      bindPhysicalPointOwners(groups, request.model);
      expect(request.model.shipmentTypeRequirements).toHaveLength(2);
      expect(current).toEqual(original);
    },
  );

  it("retains one visit for equal-priority clients and repeated orders without type dependencies", () => {
    const current = zoneBoard([
      zoneShipment(1, { unloadingMinutes: 10 }),
      zoneShipment(2, { partnerId: 1, unloadingMinutes: 10 }),
      zoneShipment(3, { unloadingMinutes: 15 }),
    ]);
    const { request, groups } = buildDirectFleetRequest(
      current,
      zoneSettings,
      "UTC",
    );
    expect(groups).toHaveLength(1);
    expect(request.model.shipments[0].loadDemands.orders.amount).toBe("3");
    expect(request.model.shipments[0].deliveries[0].duration).toBe("1500s");
    expect(request.model.shipments[0].shipmentType).toBeUndefined();
    expect(request.model.shipmentTypeRequirements).toBeUndefined();
    expect(request.model.transitionAttributes).toEqual([]);
    expect(request.model).not.toHaveProperty("precedenceRules");
  });

  it.each([0.5, 1, 1.5, 60.125])(
    "derives a forbidden delay above a changed %f-second horizon",
    (seconds) => {
      const { request } = buildDirectFleetRequest(
        zoneBoard([zoneShipment(1)]),
        zoneSettings,
        "UTC",
      );
      request.model.globalStartTime = "2026-10-02T08:00:00.000Z";
      request.model.globalEndTime = new Date(
        Date.parse(request.model.globalStartTime) + seconds * 1000,
      ).toISOString();
      const groups = [0, 2, 1, 0].map((rank) => ({
        latitude: 0,
        longitude: 0,
        rank,
      }));
      const edges = strictPriorityTransitions(groups, request.model);
      expect(edges).toHaveLength(3);
      expect(edges.every((e) => Number(e.delay!.slice(0, -1)) > seconds)).toBe(
        true,
      );
      expect(edges.map((e) => e.delay)).toEqual(
        Array(3).fill(`${Math.floor(seconds) + 1}s`),
      );
      expect(request.model.vehicles[0].routeDurationLimit).toEqual({
        maxDuration: `${seconds}s`,
      });
      expect(
        (Date.parse(request.model.globalEndTime) -
          Date.parse(request.model.globalStartTime)) /
          1000,
      ).toBe(Math.floor(seconds) + 1);
    },
  );

  it.each(["invalid", "2026-10-02T08:00:00.000Z", "2026-10-02T07:59:59.000Z"])(
    "rejects invalid or empty horizons: %s",
    (end) => {
      const { request, groups } = buildDirectFleetRequest(
        zoneBoard([zoneShipment(1)]),
        zoneSettings,
        "UTC",
      );
      request.model.globalEndTime = end;
      expect(() => strictPriorityTransitions(groups, request.model)).toThrow(
        "ROUTING_MODEL_INVALID",
      );
    },
  );

  it("rejects priority inversions, absent tags, unknown visits and two owners; accepts independent route clocks", () => {
    const current = zoneBoard([
      zoneShipment(1, { priority: "high" }),
      zoneShipment(2),
      zoneShipment(3, { priority: "medium", latitude: 20.66 }),
    ]);
    const { request } = buildDirectFleetRequest(current, zoneSettings, "UTC");
    const receipt = (routes: { vehicleIndex: number; indices: number[] }[]) =>
      ({
        routes: routes.map((r) => ({
          vehicleIndex: r.vehicleIndex,
          visits: r.indices.map((shipmentIndex) => ({ shipmentIndex })),
        })),
      }) as GoogleOptimizationResult;
    expect(() =>
      assertFleetBusinessConstraints(
        request,
        receipt([{ vehicleIndex: 0, indices: [0, 1, 2] }]),
      ),
    ).not.toThrow();
    expect(() =>
      assertFleetBusinessConstraints(
        request,
        receipt([{ vehicleIndex: 0, indices: [0, 2, 1] }]),
      ),
    ).toThrowError(
      expect.objectContaining({ details: { field: "route.customerPriority" } }),
    );
    expect(() =>
      assertFleetBusinessConstraints(
        request,
        receipt([
          { vehicleIndex: 0, indices: [0] },
          { vehicleIndex: 1, indices: [2] },
        ]),
      ),
    ).toThrowError(
      expect.objectContaining({
        details: { field: "route.physicalPointOwner" },
      }),
    );
    expect(() =>
      assertFleetBusinessConstraints(
        request,
        receipt([{ vehicleIndex: 0, indices: [99] }]),
      ),
    ).toThrowError(
      expect.objectContaining({ details: { field: "route.shipment" } }),
    );
    expect(() =>
      assertFleetBusinessConstraints(
        request,
        receipt([
          { vehicleIndex: 1, indices: [1] },
          { vehicleIndex: 0, indices: [0, 2] },
        ]),
      ),
    ).not.toThrow();
    request.model.shipments[0].deliveries[0].tags = ["unknown"];
    expect(() =>
      assertFleetBusinessConstraints(
        request,
        receipt([{ vehicleIndex: 0, indices: [0] }]),
      ),
    ).toThrow("ROUTING_RESPONSE_INVALID");
    delete request.model.shipments[0].deliveries[0].tags;
    expect(() =>
      assertFleetBusinessConstraints(
        request,
        receipt([{ vehicleIndex: 0, indices: [0] }]),
      ),
    ).toThrow("ROUTING_RESPONSE_INVALID");
    expect(() =>
      assertFleetBusinessConstraints(
        request,
        receipt([{ vehicleIndex: 0, indices: [] }]),
      ),
    ).not.toThrow();
  });

  it("connects the native business guard to the provider entry point before any service checks", () => {
    const { request } = buildDirectFleetRequest(
      zoneBoard([zoneShipment(1, { priority: "high" }), zoneShipment(2)]),
      zoneSettings,
      "UTC",
    );
    const receipt = {
      routes: [
        {
          vehicleIndex: 0,
          visits: [
            { shipmentIndex: 1, eta: "2026-10-02T08:00:00Z" },
            { shipmentIndex: 0, eta: "2026-10-02T08:00:00Z" },
          ],
        },
      ],
    } as GoogleOptimizationResult;
    expect(() => assertDirectFleetResponse(request, receipt)).toThrowError(
      expect.objectContaining({ details: { field: "route.customerPriority" } }),
    );
  });

  it("preserves smaller route limits, validates them and applies the model idempotently", () => {
    const { request } = buildDirectFleetRequest(
      zoneBoard([zoneShipment(1)]),
      zoneSettings,
      "UTC",
    );
    const groups = [0, 1, 2].map((rank) => ({
      latitude: 0,
      longitude: 0,
      rank,
    }));
    request.model.vehicles[0].routeDurationLimit = { maxDuration: "0s" };
    request.model.vehicles[1].routeDurationLimit = { maxDuration: "60.5s" };
    const end = request.model.globalEndTime;
    const edges = strictPriorityTransitions(groups, request.model);
    expect(edges.every((e) => e.delay === "61s")).toBe(true);
    expect(request.model.globalEndTime).toBe(end);
    expect(
      request.model.vehicles.map((v) => v.routeDurationLimit!.maxDuration),
    ).toEqual(["0s", "60.5s"]);
    const again = structuredClone(request.model);
    expect(strictPriorityTransitions(groups, request.model)).toEqual(edges);
    expect(request.model).toEqual(again);
    for (const invalid of ["bad", "60x", "-1s", "Infinitys"]) {
      request.model.vehicles[0].routeDurationLimit = { maxDuration: invalid };
      expect(() => strictPriorityTransitions(groups, request.model)).toThrow(
        "ROUTING_MODEL_INVALID",
      );
    }
  });
});
