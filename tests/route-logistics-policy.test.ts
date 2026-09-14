import { describe, expect, it } from "vitest";
import type { OrderBoard, Shipment } from "../src/core/orders-contract";
import {
  balancedCandidate,
  compareLogisticsScores,
  hasRoutingAlternatives,
  logisticsScoreKeys,
  logisticsSignature,
  priorityConflictIds,
  priorityGroups,
  routeLoads,
  type LogisticsScore,
  type RoutingCandidate,
} from "../src/core/route-logistics-policy";
import { buildGoogleOptimizationRequest } from "../src/core/route-optimization-google";
import {
  deterministicPlanningSnapshot as planningSnapshot,
  evaluateRoutingCandidate as evaluateCandidate,
  googleProposalCandidate as proposalCandidate,
  parseRoutingCandidate as parseCandidate,
} from "../src/core/route-candidate-evaluator";
import { calculateManualRoutes } from "../src/core/route-road";
import {
  allocationSignature,
  logisticsComparison,
} from "../src/core/route-logistics-search";
import {
  colocatedSequenceCandidate,
  deadlineSequenceCandidate,
  geographicBalancedCandidate,
} from "../src/core/route-geographic-planner";

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
      version: "priority-geographic-sequenced-v6",
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
        "maxOrders",
        "orderImbalance",
        "maxDestinations",
        "destinationImbalance",
      ],
    });
  });

  it("rejects malformed, duplicate, foreign, incomplete and split candidates", () => {
    const source = board();
    const valid: RoutingCandidate = {
      routes: [
        { vehicleId: "v1", shipmentIds: ["high", "medium"] },
        { vehicleId: "v2", shipmentIds: ["schedule"] },
      ],
    };
    expect(parseCandidate(valid, source)).toEqual(valid);
    for (const malformed of [
      null,
      [],
      "candidate",
      {},
      { routes: [] },
      { routes: "candidate" },
      {
        routes: [
          {
            vehicleId: "v1",
            shipmentIds: ["high", "medium", "schedule"],
          },
        ],
      },
      {
        routes: [
          { vehicleId: "foreign", shipmentIds: ["high", "medium"] },
          { vehicleId: "v2", shipmentIds: ["schedule"] },
        ],
      },
      {
        routes: [
          { vehicleId: "v1", shipmentIds: ["high", "medium"] },
          { vehicleId: "v1", shipmentIds: ["schedule"] },
        ],
      },
      {
        routes: [
          { vehicleId: "v1", shipmentIds: null },
          { vehicleId: "v2", shipmentIds: ["schedule"] },
        ],
      },
      {
        routes: [
          { vehicleId: "v1", shipmentIds: ["foreign", "medium"] },
          { vehicleId: "v2", shipmentIds: ["schedule"] },
        ],
      },
      {
        routes: [
          { vehicleId: "v1", shipmentIds: ["high", "medium"] },
          { vehicleId: "v2", shipmentIds: ["high"] },
        ],
      },
      {
        routes: [
          { vehicleId: "v1", shipmentIds: ["high", "medium"] },
          { vehicleId: "v2", shipmentIds: [] },
        ],
      },
    ])
      expect(() => parseCandidate(malformed, source)).toThrow(
        "ROUTING_CANDIDATE_INVALID",
      );

    source.shipments.push({
      ...source.shipments[2],
      id: "high-same-destination",
    });
    expect(() =>
      parseCandidate(
        {
          routes: [
            { vehicleId: "v1", shipmentIds: ["high", "medium"] },
            {
              vehicleId: "v2",
              shipmentIds: ["high-same-destination", "schedule"],
            },
          ],
        },
        source,
      ),
    ).toThrow("ROUTING_CUSTOMER_GROUP_INVALID");
  });

  it("measures a 15/15/15/15 baseline and rejects 33/20/5/2 for sixty independent orders", async () => {
    const source = board();
    source.vehicles = Array.from({ length: 4 }, (_, index) => ({
      ...source.vehicles[0],
      id: `v${index + 1}`,
      name: `v${index + 1}`,
      plate: `v${index + 1}`,
    }));
    source.shipments = Array.from({ length: 60 }, (_, index) =>
      shipment(`order-${index + 1}`, index + 1, "schedule"),
    );
    const baseline = balancedCandidate(
      source.shipments,
      source.vehicles.map((vehicle) => vehicle.id),
    );
    expect(routeLoads(source.shipments, baseline).routes).toMatchObject(
      [15, 15, 15, 15].map((orders) => ({ orders, destinations: orders })),
    );
    const unbalanced: RoutingCandidate = {
      routes: source.vehicles.map((vehicle, index) => ({
        vehicleId: vehicle.id,
        shipmentIds: source.shipments
          .slice([0, 33, 53, 58][index], [33, 53, 58, 60][index])
          .map((item) => item.id),
      })),
    };
    const [balancedEvaluation, unbalancedEvaluation] = await Promise.all([
      evaluateCandidate(source, baseline, settings, "UTC"),
      evaluateCandidate(source, unbalanced, settings, "UTC"),
    ]);
    expect(balancedEvaluation.score).toMatchObject({
      maxOrders: 15,
      orderImbalance: 0,
      maxDestinations: 15,
      destinationImbalance: 0,
    });
    expect(unbalancedEvaluation.score).toMatchObject({
      unusedVehicles: 0,
      maxOrders: 33,
      orderImbalance: 31,
      maxDestinations: 33,
      destinationImbalance: 31,
    });
    expect(
      compareLogisticsScores(
        balancedEvaluation.score,
        unbalancedEvaluation.score,
      ),
    ).toBeLessThan(0);
  });

  it("measures real makespan and driver-time imbalance before raw stop counts", async () => {
    const source = board();
    source.shipments.find((item) => item.id === "high")!.latitude = 21;
    source.shipments.find((item) => item.id === "medium")!.longitude = -102;
    const measured = await evaluateCandidate(
      source,
      {
        routes: [
          { vehicleId: "v1", shipmentIds: ["high"] },
          { vehicleId: "v2", shipmentIds: ["medium", "schedule"] },
        ],
      },
      settings,
      "UTC",
      async () => {},
      async (from, to) => {
        const longLeg = from.latitude === 21 || to.latitude === 21;
        const seconds = longLeg ? 100 : 50;
        return {
          distance: seconds * 10,
          seconds,
          polyline: `road-${seconds}`,
          token: null,
          trafficMode: "forecast" as const,
        };
      },
    );
    expect(measured.score).toMatchObject({
      unusedVehicles: 0,
      makespanSeconds: 200,
      imbalanceSeconds: 100,
      waitSeconds: 0,
      travelSeconds: 300,
      distanceMeters: 3000,
    });

    const single = board();
    single.shipments = [single.shipments[0]];
    const oneDestination = await evaluateCandidate(
      single,
      {
        routes: [
          { vehicleId: "v1", shipmentIds: ["schedule"] },
          { vehicleId: "v2", shipmentIds: [] },
        ],
      },
      settings,
      "UTC",
    );
    expect(oneDestination.unusedVehicles).toBe(0);
  });

  it("balances the best attainable load without splitting repeated orders from one destination", () => {
    const source = board();
    source.vehicles = Array.from({ length: 4 }, (_, index) => ({
      ...source.vehicles[0],
      id: `v${index + 1}`,
    }));
    source.shipments = [
      ...Array.from({ length: 8 }, (_, index) =>
        shipment(`group-a-${index}`, 1, "high"),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        shipment(`group-b-${index}`, 2, "medium"),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        shipment(`group-c-${index}`, 3, "schedule"),
      ),
      ...Array.from({ length: 4 }, (_, index) =>
        shipment(`group-d-${index}`, 4, "schedule"),
      ),
    ];
    const baseline = balancedCandidate(
      source.shipments,
      source.vehicles.map((vehicle) => vehicle.id),
    );
    expect(routeLoads(source.shipments, baseline).routes).toMatchObject([
      { orders: 8, destinations: 1 },
      { orders: 4, destinations: 1 },
      { orders: 4, destinations: 1 },
      { orders: 4, destinations: 1 },
    ]);
    expect(
      baseline.routes.filter((route) =>
        route.shipmentIds.some((id) => id.startsWith("group-a-")),
      ),
    ).toHaveLength(1);
    expect(routeLoads([], { routes: [] })).toEqual({
      routes: [],
      maxOrders: 0,
      orderImbalance: 0,
      maxDestinations: 0,
      destinationImbalance: 0,
    });
    expect(
      balancedCandidate(
        [],
        source.vehicles.map((vehicle) => vehicle.id),
      ).routes.every((route) => route.shipmentIds.length === 0),
    ).toBe(true);
  });
  it("assigns uneven groups largest-first and resolves equal sizes by priority", () => {
    const source = board();
    source.shipments = [
      shipment("small-schedule", 1, "schedule"),
      ...Array.from({ length: 3 }, (_, index) =>
        shipment(`large-high-${index}`, 2, "high"),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        shipment(`medium-${index}`, 3, "medium"),
      ),
    ];
    expect(balancedCandidate(source.shipments, ["v1", "v2"])).toEqual({
      routes: [
        {
          vehicleId: "v1",
          shipmentIds: ["large-high-0", "large-high-1", "large-high-2"],
        },
        {
          vehicleId: "v2",
          shipmentIds: ["medium-0", "medium-1", "small-schedule"],
        },
      ],
    });

    source.shipments = [
      shipment("schedule-0", 1, "schedule"),
      shipment("schedule-1", 1, "schedule"),
      shipment("high-0", 2, "high"),
      shipment("high-1", 2, "high"),
      shipment("medium-0", 3, "medium"),
    ];
    expect(balancedCandidate(source.shipments, ["v1", "v2"])).toEqual({
      routes: [
        {
          vehicleId: "v1",
          shipmentIds: ["high-0", "high-1", "medium-0"],
        },
        { vehicleId: "v2", shipmentIds: ["schedule-0", "schedule-1"] },
      ],
    });
  });

  it("partitions a circular geographic sweep into balanced contiguous fleet sectors", () => {
    const source = board();
    source.vehicles = Array.from({ length: 4 }, (_, index) => ({
      ...source.vehicles[0],
      id: `v${index + 1}`,
    }));
    const points = [
      [20, -102.9],
      [20.001, -102.9],
      [20.1, -103],
      [20.1, -103.001],
      [20, -103.1],
      [19.999, -103.1],
      [19.9, -103],
      [19.9, -102.999],
    ];
    source.shipments = [4, 0, 6, 2, 5, 1, 7, 3].map((index) => ({
      ...shipment(`zone-${index}`, index + 1, "schedule"),
      latitude: points[index][0],
      longitude: points[index][1],
    }));
    const result = geographicBalancedCandidate(
      source.shipments,
      source.vehicles.map((vehicle) => vehicle.id),
      { latitude: 20, longitude: -103 },
    );
    expect(result).toEqual({
      routes: [
        { vehicleId: "v1", shipmentIds: ["zone-6", "zone-7"] },
        { vehicleId: "v2", shipmentIds: ["zone-0", "zone-1"] },
        { vehicleId: "v3", shipmentIds: ["zone-2", "zone-3"] },
        { vehicleId: "v4", shipmentIds: ["zone-4", "zone-5"] },
      ],
    });
    expect(routeLoads(source.shipments, result).routes).toMatchObject(
      [2, 2, 2, 2].map((orders) => ({ orders, destinations: orders })),
    );
    for (const route of result.routes) {
      const routePoints = route.shipmentIds.map((id) =>
        source.shipments.find((item) => item.id === id),
      );
      expect(
        new Set(
          routePoints.map((item) => {
            const latitude = item!.latitude!;
            const longitude = item!.longitude!;
            return Math.abs(latitude - 20) > Math.abs(longitude + 103)
              ? latitude > 20
                ? "north"
                : "south"
              : longitude > -103
                ? "east"
                : "west";
          }),
        ).size,
      ).toBe(1);
    }
  });

  it("isolates an indivisible heavy destination while preserving adjacent angular sectors", () => {
    const source = board();
    const definitions = [
      ["east", 8, 20, -102.9],
      ["north-east", 1, 20.08, -102.92],
      ["north", 1, 20.1, -103],
      ["west", 1, 20, -103.1],
      ["south", 1, 19.9, -103],
      ["south-east", 1, 19.92, -102.92],
    ] as const;
    source.shipments = definitions.flatMap(
      ([name, orders, latitude, longitude], partnerIndex) =>
        Array.from({ length: orders }, (_, orderIndex) => ({
          ...shipment(`${name}-${orderIndex}`, partnerIndex + 1, "schedule"),
          latitude,
          longitude,
        })),
    );
    expect(
      geographicBalancedCandidate(source.shipments, ["v1", "v2", "v3"], {
        latitude: 20,
        longitude: -103,
      }),
    ).toEqual({
      routes: [
        {
          vehicleId: "v1",
          shipmentIds: ["west-0", "south-0", "south-east-0"],
        },
        {
          vehicleId: "v2",
          shipmentIds: Array.from({ length: 8 }, (_, index) => `east-${index}`),
        },
        {
          vehicleId: "v3",
          shipmentIds: ["north-east-0", "north-0"],
        },
      ],
    });
  });

  it("cuts a dense circular sweep at its true widest gap", () => {
    const angles = [-3, -2.2, -1.4, -0.6, 0.35, 1.15, 1.95, 2.75];
    const source = board();
    source.shipments = [...angles.keys()].reverse().map((index) => ({
      ...shipment(`angle-${index}`, index + 1, "schedule"),
      latitude: 20 + Math.sin(angles[index]) * 0.1,
      longitude: -103 + Math.cos(angles[index]) * 0.1,
    }));
    expect(
      geographicBalancedCandidate(source.shipments, ["v1", "v2", "v3", "v4"], {
        latitude: 20,
        longitude: -103,
      }),
    ).toEqual({
      routes: [
        { vehicleId: "v1", shipmentIds: ["angle-4", "angle-5"] },
        { vehicleId: "v2", shipmentIds: ["angle-6", "angle-7"] },
        { vehicleId: "v3", shipmentIds: ["angle-0", "angle-1"] },
        { vehicleId: "v4", shipmentIds: ["angle-2", "angle-3"] },
      ],
    });
  });

  it("matches an independent exhaustive optimum for asymmetric group loads", () => {
    const partitionCost = (
      weights: number[],
      parts: number,
      cuts: number[],
    ) => {
      const count = weights.length;
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const boundaries = [0, ...cuts, count];
      return boundaries.slice(1).reduce((cost, end, index) => {
        const start = boundaries[index];
        const orders = weights
          .slice(start, end)
          .reduce((sum, weight) => sum + weight, 0);
        const destinations = end - start;
        const orderDelta = orders * parts - total;
        const destinationDelta = destinations * parts - count;
        return (
          cost +
          orderDelta * orderDelta * (count + 1) * (count + 1) +
          destinationDelta * destinationDelta
        );
      }, 0);
    };
    const optimalCuts = (weights: number[], parts: number) => {
      let best: { cost: number; cuts: number[] } | null = null;
      const choose = (cuts: number[], next: number) => {
        if (cuts.length === parts - 1) {
          const cost = partitionCost(weights, parts, cuts);
          if (!best || cost < best.cost) best = { cost, cuts: [...cuts] };
          return;
        }
        const remainingCuts = parts - 1 - cuts.length;
        for (let cut = next; cut <= weights.length - remainingCuts; cut++)
          choose([...cuts, cut], cut + 1);
      };
      choose([], 1);
      return best!.cuts;
    };
    for (let encoded = 0; encoded < 3 ** 5; encoded++) {
      let value = encoded;
      const weights = Array.from({ length: 5 }, () => {
        const weight = (value % 3) + 1;
        value = Math.floor(value / 3);
        return weight;
      });
      const source = board();
      source.shipments = weights.flatMap((orders, groupIndex) =>
        Array.from({ length: orders }, (_, orderIndex) => ({
          ...shipment(
            `group-${groupIndex}-${orderIndex}`,
            groupIndex + 1,
            "schedule",
          ),
          longitude: -102.99 + groupIndex * 0.001,
        })),
      );
      const cuts = optimalCuts(weights, 3);
      const boundaries = [0, ...cuts, weights.length];
      const expected = boundaries
        .slice(1)
        .map((end, routeIndex) =>
          Array.from(
            { length: end - boundaries[routeIndex] },
            (_, offset) => `group-${boundaries[routeIndex] + offset}`,
          ),
        );
      const actual = geographicBalancedCandidate(
        source.shipments,
        ["v1", "v2", "v3"],
        { latitude: 20, longitude: -103 },
      ).routes.map((route) => [
        ...new Set(
          route.shipmentIds.map((id) => id.split("-").slice(0, 2).join("-")),
        ),
      ]);
      expect(actual).toEqual(expected);
    }
  });

  it("handles an empty workload, surplus fleet and exact coordinate boundaries", () => {
    const source = board();
    expect(
      geographicBalancedCandidate([], ["v1", "v2"], {
        latitude: 20,
        longitude: -103,
      }),
    ).toEqual({
      routes: [
        { vehicleId: "v1", shipmentIds: [] },
        { vehicleId: "v2", shipmentIds: [] },
      ],
    });
    expect(
      geographicBalancedCandidate([source.shipments[0]], ["v1", "v2"], {
        latitude: 20,
        longitude: -103,
      }),
    ).toEqual({
      routes: [
        { vehicleId: "v1", shipmentIds: ["schedule"] },
        { vehicleId: "v2", shipmentIds: [] },
      ],
    });
    expect(
      geographicBalancedCandidate(source.shipments, [], {
        latitude: 20,
        longitude: -103,
      }),
    ).toEqual({ routes: [] });
    source.shipments[0].latitude = 90;
    source.shipments[0].longitude = 180;
    expect(() =>
      geographicBalancedCandidate(source.shipments, ["v1"], {
        latitude: 20,
        longitude: -103,
      }),
    ).not.toThrow();
    source.shipments[0].longitude = 180.01;
    expect(() =>
      geographicBalancedCandidate(source.shipments, ["v1"], {
        latitude: 20,
        longitude: -103,
      }),
    ).toThrow("ROUTING_POINTS_REQUIRED");
  });

  it("keeps customer groups intact and sequences priority before earliest deadline", () => {
    const source = board();
    source.vehicles = [source.vehicles[0]];
    source.shipments = [
      shipment("schedule", 1, "schedule"),
      shipment("high-later", 2, "high"),
      shipment("medium", 3, "medium"),
      shipment("high-urgent", 4, "high"),
      shipment("high-urgent-second", 4, "schedule"),
    ];
    source.shipments[1].deliveryWindows = [
      { startMinute: 480, endMinute: 660 },
    ];
    source.shipments[3].deliveryWindows = [
      { startMinute: 480, endMinute: 540 },
    ];
    source.shipments[4].deliveryWindows = [
      { startMinute: 480, endMinute: 540 },
    ];
    const result = deadlineSequenceCandidate(
      source.shipments,
      {
        routes: [
          {
            vehicleId: "v1",
            shipmentIds: source.shipments.map((item) => item.id),
          },
        ],
      },
      { latitude: 20, longitude: -103 },
    );
    expect(result.routes[0].shipmentIds).toEqual([
      "high-urgent",
      "high-urgent-second",
      "high-later",
      "medium",
      "schedule",
    ]);
    expect(
      geographicBalancedCandidate(source.shipments, ["v1", "v2"], {
        latitude: 20,
        longitude: -103,
      }).routes.filter((route) => route.shipmentIds.includes("high-urgent"))[0]
        .shipmentIds,
    ).toContain("high-urgent-second");
  });

  it("offers a measured candidate that avoids returning to an exact physical point", () => {
    const source = board();
    source.vehicles = [source.vehicles[0]];
    source.shipments = [
      shipment("cocos", 132, "schedule"),
      shipment("middle", 200, "schedule"),
      shipment("metate", 75, "schedule"),
      shipment("metate-second", 75, "schedule"),
    ];
    source.shipments[0].latitude = 20.709614;
    source.shipments[0].longitude = -103.411964;
    source.shipments[1].latitude = 20.72;
    source.shipments[1].longitude = -103.4;
    source.shipments[2].latitude = 20.709614;
    source.shipments[2].longitude = -103.411964;
    source.shipments[3].latitude = 20.709614;
    source.shipments[3].longitude = -103.411964;
    expect(
      colocatedSequenceCandidate(source.shipments, {
        routes: [
          {
            vehicleId: "v1",
            shipmentIds: ["cocos", "middle", "metate", "metate-second"],
          },
        ],
      }).routes[0].shipmentIds,
    ).toEqual(["cocos", "metate", "metate-second", "middle"]);
  });

  it("never compacts colocated customers across priority tiers", () => {
    const source = board();
    source.vehicles = [source.vehicles[0]];
    source.shipments = [
      shipment("high", 1, "high"),
      shipment("medium", 2, "medium"),
      shipment("same-point-schedule", 3, "schedule"),
    ];
    source.shipments[1].latitude = 21;
    expect(
      colocatedSequenceCandidate(source.shipments, {
        routes: [
          {
            vehicleId: "v1",
            shipmentIds: ["high", "medium", "same-point-schedule"],
          },
        ],
      }).routes[0].shipmentIds,
    ).toEqual(["high", "medium", "same-point-schedule"]);
  });

  it("rejects every incomplete point before building a colocated candidate", () => {
    for (const invalid of [
      { latitude: null },
      { longitude: null },
      { locationStatus: "pending" as const },
    ]) {
      const source = board();
      Object.assign(source.shipments[0], invalid);
      expect(() =>
        colocatedSequenceCandidate(source.shipments, {
          routes: [
            {
              vehicleId: "v1",
              shipmentIds: source.shipments.map((item) => item.id),
            },
            { vehicleId: "v2", shipmentIds: [] },
          ],
        }),
      ).toThrow("ROUTING_POINTS_REQUIRED");
    }
  });

  it("preserves an empty route without inventing a stop", () => {
    expect(
      colocatedSequenceCandidate([], {
        routes: [{ vehicleId: "v1", shipmentIds: [] }],
      }),
    ).toEqual({ routes: [{ vehicleId: "v1", shipmentIds: [] }] });
  });

  it("uses opening, angle, radius and stable identity as deadline tie breakers", () => {
    const source = board();
    source.shipments = [
      ["west", 20, -103.1, 480],
      ["far-east", 20, -102.9, 480],
      ["near-east", 20, -102.99, 480],
      ["same-b", 20.001, -102.99, 480],
      ["same-a", 20.001, -102.99, 480],
      ["opens-later", 19.9, -103, 500],
    ].map(([id, latitude, longitude, startMinute], index) => ({
      ...shipment(String(id), index + 1, "high"),
      latitude: Number(latitude),
      longitude: Number(longitude),
      deliveryWindows: [{ startMinute: Number(startMinute), endMinute: 600 }],
    }));
    expect(
      deadlineSequenceCandidate(
        source.shipments,
        {
          routes: [
            {
              vehicleId: "v1",
              shipmentIds: source.shipments.map((item) => item.id).reverse(),
            },
          ],
        },
        { latitude: 20, longitude: -103 },
      ).routes[0].shipmentIds,
    ).toEqual([
      "near-east",
      "far-east",
      "same-a",
      "same-b",
      "west",
      "opens-later",
    ]);
  });

  it("orders collinear deadline ties by radius even when input is reversed", () => {
    const source = board();
    source.shipments = [
      shipment("far", 1, "high"),
      shipment("near", 2, "high"),
    ];
    source.shipments[0].latitude = 20.02;
    source.shipments[0].longitude = -102.98;
    source.shipments[1].latitude = 20.01;
    source.shipments[1].longitude = -102.99;
    for (const item of source.shipments)
      item.deliveryWindows = [{ startMinute: 480, endMinute: 600 }];
    expect(
      deadlineSequenceCandidate(
        source.shipments,
        {
          routes: [{ vehicleId: "v1", shipmentIds: ["far", "near"] }],
        },
        { latitude: 20, longitude: -103 },
      ).routes[0].shipmentIds,
    ).toEqual(["near", "far"]);
  });

  it("uses the earliest member window for an indivisible customer group", () => {
    const source = board();
    source.shipments = [
      shipment("group-first", 1, "high"),
      shipment("group-second", 1, "high"),
      shipment("competitor", 2, "high"),
    ];
    source.shipments[0].deliveryWindows = [
      { startMinute: 480, endMinute: 540 },
    ];
    source.shipments[1].deliveryWindows = [
      { startMinute: 520, endMinute: 700 },
    ];
    source.shipments[2].deliveryWindows = [
      { startMinute: 500, endMinute: 600 },
    ];
    expect(
      deadlineSequenceCandidate(
        source.shipments,
        {
          routes: [
            {
              vehicleId: "v1",
              shipmentIds: ["competitor", "group-first", "group-second"],
            },
          ],
        },
        { latitude: 20, longitude: -103 },
      ).routes[0].shipmentIds,
    ).toEqual(["group-first", "group-second", "competitor"]);
  });

  it("uses the earliest opening when customer deadlines are equal", () => {
    const source = board();
    source.shipments = [
      shipment("group-first", 1, "high"),
      shipment("group-second", 1, "high"),
      shipment("competitor", 2, "high"),
    ];
    source.shipments[0].deliveryWindows = [
      { startMinute: 480, endMinute: 600 },
    ];
    source.shipments[1].deliveryWindows = [
      { startMinute: 520, endMinute: 600 },
    ];
    source.shipments[2].deliveryWindows = [
      { startMinute: 500, endMinute: 600 },
    ];
    expect(
      deadlineSequenceCandidate(
        source.shipments,
        {
          routes: [
            {
              vehicleId: "v1",
              shipmentIds: ["competitor", "group-first", "group-second"],
            },
          ],
        },
        { latitude: 20, longitude: -103 },
      ).routes[0].shipmentIds,
    ).toEqual(["group-first", "group-second", "competitor"]);
  });

  it("rejects missing geographic points instead of inventing a route", () => {
    const source = board();
    source.shipments[0].latitude = null;
    expect(() =>
      geographicBalancedCandidate(source.shipments, ["v1"], {
        latitude: 20,
        longitude: -103,
      }),
    ).toThrow("ROUTING_POINTS_REQUIRED");
    expect(() =>
      geographicBalancedCandidate(source.shipments, ["v1"], {
        latitude: 200,
        longitude: -103,
      }),
    ).toThrow("ROUTING_ORIGIN_REQUIRED");
    source.shipments[0].latitude = 90.01;
    expect(() =>
      geographicBalancedCandidate(source.shipments, ["v1"], {
        latitude: 20,
        longitude: -103,
      }),
    ).toThrow("ROUTING_POINTS_REQUIRED");
    source.shipments[0] = {
      ...shipment("pending", 99, "schedule"),
      locationStatus: "pending",
    };
    expect(() =>
      geographicBalancedCandidate(source.shipments, ["v1"], {
        latitude: 20,
        longitude: -103,
      }),
    ).toThrow("ROUTING_POINTS_REQUIRED");
  });
  it("preserves a measured road sequence and exposes priority violations instead of silently rearranging it", async () => {
    const source = board();
    source.shipments.push(
      {
        ...source.shipments[0],
        id: "pickup",
        fulfillmentMode: "pickup",
      },
      {
        ...source.shipments[0],
        id: "archived",
        customerArchived: true,
      },
    );
    const input = candidate(["schedule", "medium", "high"]);
    const original = structuredClone(input);
    expect(priorityConflictIds(source.shipments, input)).toEqual(
      new Set(["medium", "high"]),
    );
    const result = await evaluateCandidate(
      source,
      parseCandidate(input, source),
      settings,
      "UTC",
    );
    expect(result.candidate).toEqual(original);
    expect(input).toEqual(original);
    expect(result.board.shipments).toHaveLength(source.shipments.length);
    expect(new Set(result.board.shipments.map((item) => item.id)).size).toBe(
      source.shipments.length,
    );
    expect(
      result.board.shipments
        .filter((item) => ["pickup", "archived"].includes(item.id))
        .map((item) => [item.id, item.vehicle_id]),
    ).toEqual([
      ["pickup", null],
      ["archived", null],
    ]);
    expect(
      result.board.shipments
        .filter((item) => item.vehicle_id === "v1")
        .map((item) => [item.id, item.position]),
    ).toEqual([
      ["schedule", 1],
      ["medium", 2],
      ["high", 3],
    ]);
    expect(result.score.priorityConflicts).toBe(2);
    expect(result.result.routes[0].stops.map((s) => s.shipmentId)).toEqual([
      "schedule",
      "medium",
      "high",
    ]);
    expect(new Set(result.result.routes[0].stops.map((s) => s.eta)).size).toBe(
      1,
    );
  });

  it("uses the strongest priority of an intact customer group when detecting conflicts", () => {
    const source = board();
    source.shipments.push(
      shipment("high2", 3, "schedule"),
      shipment("schedule2", 4, "schedule"),
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

  it("counts an unused truck when destinations equal trucks and excludes it from active-driver time imbalance", async () => {
    const source = board();
    source.shipments = source.shipments.slice(0, 2);
    source.shipments[0].latitude = 21;
    source.shipments[1].longitude = -102;
    const result = await evaluateCandidate(
      source,
      {
        routes: [
          {
            vehicleId: "v1",
            shipmentIds: source.shipments.map((item) => item.id),
          },
          { vehicleId: "v2", shipmentIds: [] },
        ],
      },
      settings,
      "UTC",
      async () => {},
      async () => ({
        distance: 100,
        seconds: 100,
        polyline: "road",
        token: null,
        trafficMode: "static",
      }),
    );
    expect(result.unusedVehicles).toBe(1);
    expect(result.imbalanceSeconds).toBe(0);
    expect(result.score.makespanSeconds).toBe(300);
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
    source.shipments.push({
      ...source.shipments[2],
      id: "high2",
      deliveryWindows: [],
    });
    source.shipments[1].deliveryWindows = [
      { startMinute: 300, endMinute: 400 },
      { startMinute: 540, endMinute: 600 },
    ];
    const result = await evaluateCandidate(
      source,
      candidate(["high", "high2", "medium", "schedule"]),
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
    expect(result.result.routes[0].stops).toMatchObject([
      {
        shipmentId: "high",
        eta: "2026-09-12T08:00:00.000Z",
        lateSeconds: 3600,
      },
      {
        shipmentId: "high2",
        eta: "2026-09-12T08:00:00.000Z",
        lateSeconds: 0,
      },
      {
        shipmentId: "medium",
        eta: "2026-09-12T09:00:00.000Z",
        waitDurationSeconds: 3600,
        lateSeconds: 0,
      },
      { shipmentId: "schedule", lateSeconds: 0 },
    ]);
    expect(result.timezone).toBe("UTC");
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
    expect(bad.result.routes[0].stops[0]).toMatchObject({
      eta: "2026-09-12T12:00:00.000Z",
      waitDurationSeconds: 14400,
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
    expect(lateWindow.costPerHourAfterSoftEndTime).toBeGreaterThan(
      request.model.vehicles[0].loadLimits.orders.costPerUnitAboveSoftMax,
    );
    const multiple = request.model.shipments[1].deliveries[0].timeWindows![0];
    expect(multiple.startTime).toBe("2026-09-12T10:00:00.000Z");
    expect(multiple.softEndTime).toBe("2026-09-12T16:00:00.000Z");
    expect(request.model.shipments[2].deliveries[0]).not.toHaveProperty(
      "timeWindows",
    );
  });
});
