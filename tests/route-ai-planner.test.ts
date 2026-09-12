import { describe, expect, it } from "vitest";
import type { OrderBoard, Shipment } from "../src/core/orders-contract";
import { readOpenAIRoutingConfig } from "../src/core/openai-routing-config";
import {
  candidateCommitDecision,
  evaluateCandidate,
  parseCandidate,
  planningSnapshot,
  proposalCandidate,
} from "../src/core/route-ai-planner";
import type { GoogleOptimizationResult } from "../src/core/route-optimization-google";

const vehicle = (id: string) => ({
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
});
const shipment = (
  id: string,
  priority: Shipment["priority"],
  mode: Shipment["fulfillmentMode"] = "delivery",
): Shipment => ({
  id,
  priority,
  fulfillmentMode: mode,
  customerArchived: false,
  vehicle_id: null,
  position: 1,
  pickingId: 1,
  pickingName: "WH/OUT/1",
  orderId: 1,
  orderName: "S1",
  partnerId: Number(id.slice(-12)),
  customerName: "Dato no ejecutable",
  address: "",
  validatedAt: "2026-09-10T00:00:00Z",
  promisedAt: null,
  backorderId: null,
  lines: [],
  window_start: null,
  window_end: null,
  high_priority: null,
  deliveryWindows: [],
  deliveryNote: "",
  phone: null,
  mapUrl: null,
  latitude: 20,
  longitude: -103,
  locationStatus: "confirmed",
});
const board: OrderBoard = {
  plan: {
    id: "00000000-0000-4000-8000-000000000001",
    service_date: "2026-09-10",
    label: "QA",
    version: 1,
    updated_at: "2026-09-10T00:00:00Z",
    departure_minute: 480,
  },
  vehicles: [
    vehicle("00000000-0000-4000-8000-000000000011"),
    vehicle("00000000-0000-4000-8000-000000000012"),
  ],
  shipments: [
    shipment("00000000-0000-4000-8000-000000000021", "high"),
    shipment("00000000-0000-4000-8000-000000000022", "medium"),
    shipment("00000000-0000-4000-8000-000000000023", "schedule"),
    shipment("00000000-0000-4000-8000-000000000024", "high", "pickup"),
  ],
};
const valid = {
  routes: [
    {
      vehicleId: board.vehicles[0].id,
      shipmentIds: [board.shipments[0].id, board.shipments[1].id],
    },
    { vehicleId: board.vehicles[1].id, shipmentIds: [board.shipments[2].id] },
  ],
};

describe("OpenAI candidate boundary", () => {
  it("accepts the complete loaded batch without truncating, duplicating or omitting IDs", () => {
    const loaded = structuredClone(board);
    loaded.shipments = Array.from({ length: 61 }, (_, index) =>
      shipment(
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        "high",
      ),
    );
    const candidate = {
      routes: loaded.vehicles.map((item, vehicleIndex) => ({
        vehicleId: item.id,
        shipmentIds: loaded.shipments
          .filter((_, shipmentIndex) => shipmentIndex % 2 === vehicleIndex)
          .map((item) => item.id),
      })),
    };
    const parsed = parseCandidate(candidate, loaded);
    const ids = parsed.routes.flatMap((route) => route.shipmentIds);
    expect(ids).toHaveLength(loaded.shipments.length);
    expect(new Set(ids).size).toBe(loaded.shipments.length);
    expect(new Set(ids)).toEqual(
      new Set(loaded.shipments.map((item) => item.id)),
    );
    const incomplete = structuredClone(candidate);
    incomplete.routes[0].shipmentIds.pop();
    expect(() => parseCandidate(incomplete, loaded)).toThrow(
      "ROUTING_AI_CANDIDATE_INVALID",
    );
  });
  it("sends opaque complete groups without customer PII and counts alternatives by groups", () => {
    const settings = {
      depotAddress: "",
      depotLocation: null,
      version: 1,
      updatedAt: null,
    };
    const context = planningSnapshot(board, settings);
    expect(context.deliveryGroups).toEqual(
      board.shipments
        .slice(0, 3)
        .map((s) => ({ id: s.id, shipmentIds: [s.id] })),
    );
    expect(context.shipments).toEqual(
      board.shipments.slice(0, 3).map((s) => ({
        id: s.id,
        latitude: s.latitude,
        longitude: s.longitude,
        priority: s.priority,
        windows: s.deliveryWindows,
      })),
    );
    expect(context).toMatchObject({
      planId: board.plan.id,
      serviceDate: board.plan.service_date,
      departureMinute: 480,
      depot: null,
      vehicles: board.vehicles.map((v) => ({ id: v.id })),
    });
    expect(JSON.stringify(context)).not.toContain("Dato no ejecutable");
    const repeated = structuredClone(board);
    repeated.shipments.forEach((s) => (s.partnerId = 1));
    repeated.shipments.push({
      ...repeated.shipments[0],
      id: "archived",
      customerArchived: true,
    });
    const grouped = planningSnapshot(repeated, settings);
    expect(grouped.deliveryGroups).toEqual([
      {
        id: board.shipments[0].id,
        shipmentIds: board.shipments.slice(0, 3).map((s) => s.id),
      },
    ]);
    expect(grouped.shipments).toHaveLength(3);
  });
  it("maps Google indices only against eligible delivery shipments", () => {
    const mixed = structuredClone(board);
    mixed.shipments = [
      { ...mixed.shipments[0], id: "pickup", fulfillmentMode: "pickup" },
      ...mixed.shipments,
      { ...mixed.shipments[0], id: "archived", customerArchived: true },
    ];
    const result = {
      routes: [
        {
          vehicleIndex: 0,
          visits: [{ shipmentIndex: 0 }, { shipmentIndex: 1 }],
        },
        { vehicleIndex: 1, visits: [{ shipmentIndex: 2 }] },
      ],
    } as GoogleOptimizationResult;
    expect(proposalCandidate(mixed, result)).toEqual(valid);
  });
  it("also rejects a split before measuring a candidate supplied directly", async () => {
    const repeated = structuredClone(board);
    repeated.shipments[2].partnerId = repeated.shipments[0].partnerId;
    await expect(
      evaluateCandidate(
        repeated,
        valid,
        { depotAddress: "", depotLocation: null, version: 1, updatedAt: null },
        "UTC",
      ),
    ).rejects.toThrow("ROUTING_CUSTOMER_GROUP_INVALID");
  });
  it.each(["high", "medium"] as const)(
    "rejects splitting one %s customer's orders between drivers (reported regression)",
    (priority) => {
      const repeated = structuredClone(board);
      repeated.shipments[0].priority = priority;
      repeated.shipments[2].priority = priority;
      repeated.shipments[2].partnerId = repeated.shipments[0].partnerId;
      repeated.shipments[1].priority = "schedule";
      expect(() => parseCandidate(valid, repeated)).toThrow(
        "ROUTING_CUSTOMER_GROUP_INVALID",
      );
    },
  );
  it("rejects returning to the same customer after another stop", () => {
    const repeated = structuredClone(board);
    repeated.shipments.forEach((item) => (item.priority = "high"));
    repeated.shipments[2].partnerId = repeated.shipments[0].partnerId;
    expect(() =>
      parseCandidate(
        {
          routes: [
            {
              vehicleId: board.vehicles[0].id,
              shipmentIds: repeated.shipments.slice(0, 3).map((s) => s.id),
            },
            { vehicleId: board.vehicles[1].id, shipmentIds: [] },
          ],
        },
        repeated,
      ),
    ).toThrow("ROUTING_CUSTOMER_GROUP_INVALID");
  });
  it("does not force splitting a single customer just to occupy two trucks", async () => {
    const repeated = structuredClone(board);
    repeated.shipments.forEach((s) => {
      s.partnerId = 1;
      s.priority = "high";
    });
    const candidate = parseCandidate(
      {
        routes: [
          {
            vehicleId: board.vehicles[0].id,
            shipmentIds: repeated.shipments.slice(0, 3).map((s) => s.id),
          },
          { vehicleId: board.vehicles[1].id, shipmentIds: [] },
        ],
      },
      repeated,
    );
    const evaluated = await evaluateCandidate(
      repeated,
      candidate,
      {
        depotAddress: "",
        depotLocation: { latitude: 20, longitude: -103, placeId: "warehouse" },
        version: 1,
        updatedAt: null,
      },
      "UTC",
    );
    expect(evaluated.unusedVehicles).toBe(0);
    expect(evaluated.feasible).toBe(true);
    expect(evaluated.result.metrics.performedShipmentCount).toBe(3);
  });
  it("blocks unknown and non-best commits without rejecting soft conflicts", () => {
    const chosen = { id: "chosen", feasible: true };
    expect(candidateCommitDecision(undefined, chosen)).toEqual({
      error: "Candidate must be the lowest-score complete evaluated candidate.",
    });
    expect(candidateCommitDecision(chosen, { id: "better" })).toEqual({
      error: "Candidate must be the lowest-score complete evaluated candidate.",
    });
    expect(candidateCommitDecision(chosen, undefined)).toEqual({
      error: "Candidate must be the lowest-score complete evaluated candidate.",
    });
    expect(
      candidateCommitDecision({ ...chosen, feasible: false }, chosen),
    ).toEqual({ chosen: { ...chosen, feasible: false } });
    expect(candidateCommitDecision(chosen, chosen)).toEqual({ chosen });
  });
  it("accepts exact delivery coverage and every vehicle", () => {
    expect(parseCandidate(valid, board)).toEqual(valid);
    const equalPriority: OrderBoard = {
      ...board,
      shipments: board.shipments.map((item, index) =>
        index === 1 ? { ...item, priority: "high" } : item,
      ),
    };
    expect(parseCandidate(valid, equalPriority)).toEqual(valid);
  });
  it.each([
    null,
    {},
    { routes: [] },
    { routes: "invalid" },
    { routes: [null, valid.routes[1]] },
    { routes: [{ ...valid.routes[0], vehicleId: 42 }, valid.routes[1]] },
    {
      routes: [{ ...valid.routes[0], shipmentIds: "invalid" }, valid.routes[1]],
    },
    {
      routes: [
        { ...valid.routes[0], shipmentIds: [42, board.shipments[1].id] },
        valid.routes[1],
      ],
    },
    { routes: [valid.routes[0], valid.routes[0]] },
    { routes: [{ ...valid.routes[0], vehicleId: "outside" }, valid.routes[1]] },
    {
      routes: [
        { ...valid.routes[0], shipmentIds: [board.shipments[0].id] },
        valid.routes[1],
      ],
    },
    {
      routes: [
        {
          ...valid.routes[0],
          shipmentIds: [board.shipments[0].id, board.shipments[0].id],
        },
        valid.routes[1],
      ],
    },
    {
      routes: [
        { ...valid.routes[0], shipmentIds: [board.shipments[0].id, "outside"] },
        valid.routes[1],
      ],
    },
    {
      routes: [
        {
          ...valid.routes[0],
          shipmentIds: [board.shipments[0].id, board.shipments[3].id],
        },
        valid.routes[1],
      ],
    },
    {
      routes: [
        {
          vehicleId: board.vehicles[0].id,
          shipmentIds: board.shipments.slice(0, 3).map((item) => item.id),
        },
      ],
    },
    {
      routes: [
        {
          vehicleId: board.vehicles[0].id,
          shipmentIds: [board.shipments[0].id, board.shipments[1].id],
        },
        {
          vehicleId: board.vehicles[0].id,
          shipmentIds: [board.shipments[2].id],
        },
      ],
    },
    {
      routes: [
        { vehicleId: board.vehicles[0].id, shipmentIds: [42] },
        {
          vehicleId: board.vehicles[1].id,
          shipmentIds: [board.shipments[1].id, board.shipments[2].id],
        },
      ],
    },
    {
      routes: [
        { vehicleId: board.vehicles[0].id, shipmentIds: ["outside"] },
        {
          vehicleId: board.vehicles[1].id,
          shipmentIds: [board.shipments[1].id, board.shipments[2].id],
        },
      ],
    },
  ])(
    "rejects foreign, missing, duplicate or non-delivery input %#",
    (candidate) => {
      expect(() => parseCandidate(candidate, board)).toThrow(
        "ROUTING_AI_CANDIDATE_INVALID",
      );
    },
  );
  it("accepts priority conflicts as measurable preferences instead of blockers", () => {
    expect(
      parseCandidate(
        {
          routes: [
            {
              vehicleId: board.vehicles[0].id,
              shipmentIds: [board.shipments[0].id],
            },
            {
              vehicleId: board.vehicles[1].id,
              shipmentIds: [board.shipments[1].id, board.shipments[2].id],
            },
          ],
        },
        board,
      ).routes[1].shipmentIds,
    ).toEqual([board.shipments[1].id, board.shipments[2].id]);
    expect(
      parseCandidate(
        {
          routes: [
            {
              vehicleId: board.vehicles[0].id,
              shipmentIds: [board.shipments[2].id, board.shipments[1].id],
            },
            {
              vehicleId: board.vehicles[1].id,
              shipmentIds: [board.shipments[0].id],
            },
          ],
        },
        board,
      ).routes[0].shipmentIds,
    ).toEqual([board.shipments[2].id, board.shipments[1].id]);
  });
  it("evaluates balance and global priority with deterministic zero-distance roads", async () => {
    const settings = {
      depotAddress: "Bodega",
      depotLocation: { latitude: 20, longitude: -103, placeId: "warehouse" },
      version: 1,
      updatedAt: "2026-09-10T00:00:00Z",
    };
    const feasible = await evaluateCandidate(
      board,
      parseCandidate(valid, board),
      settings,
      "UTC",
    );
    expect(feasible).toMatchObject({
      feasible: true,
      lateStops: 0,
      priorityConflicts: 0,
      unusedVehicles: 0,
      imbalanceSeconds: 0,
      score: {
        priorityConflicts: 0,
        lateStops: 0,
        lateSeconds: 0,
        unusedVehicles: 0,
        makespanSeconds: 0,
        distanceMeters: 0,
        travelSeconds: 0,
      },
    });
    expect(
      feasible.result.routes.every(
        (route) => route.finishedAt === route.departureAt,
      ),
    ).toBe(true);
    expect(feasible.board.shipments.map((item) => item.id)).toEqual([
      board.shipments[0].id,
      board.shipments[1].id,
      board.shipments[2].id,
      board.shipments[3].id,
    ]);
    expect(feasible.board.shipments.map((item) => item.position)).toEqual([
      1, 2, 1, 1,
    ]);

    const constrained: OrderBoard = {
      ...board,
      shipments: board.shipments.map((item, index) =>
        index === 0
          ? {
              ...item,
              deliveryWindows: [{ startMinute: 600, endMinute: 660 }],
            }
          : item,
      ),
    };
    const split = parseCandidate(
      {
        routes: [
          {
            vehicleId: board.vehicles[0].id,
            shipmentIds: [board.shipments[0].id],
          },
          {
            vehicleId: board.vehicles[1].id,
            shipmentIds: [board.shipments[1].id, board.shipments[2].id],
          },
        ],
      },
      constrained,
    );
    const conflict = await evaluateCandidate(
      constrained,
      split,
      settings,
      "UTC",
    );
    expect(conflict).toMatchObject({
      feasible: true,
      priorityConflicts: 2,
      imbalanceSeconds: 7200,
      score: {
        priorityConflicts: 2,
        makespanSeconds: 7200,
        imbalanceSeconds: 7200,
      },
    });

    const unequalBoard: OrderBoard = {
      ...board,
      shipments: board.shipments.map((item, index) =>
        index === 0
          ? {
              ...item,
              deliveryWindows: [{ startMinute: 600, endMinute: 660 }],
            }
          : index === 1
            ? {
                ...item,
                deliveryWindows: [{ startMinute: 540, endMinute: 600 }],
              }
            : item,
      ),
    };
    const unequal = await evaluateCandidate(
      unequalBoard,
      parseCandidate(split, unequalBoard),
      settings,
      "UTC",
    );
    expect(unequal.imbalanceSeconds).toBe(3600);

    const unused = await evaluateCandidate(
      board,
      parseCandidate(
        {
          routes: [
            {
              vehicleId: board.vehicles[0].id,
              shipmentIds: board.shipments.slice(0, 3).map((item) => item.id),
            },
            { vehicleId: board.vehicles[1].id, shipmentIds: [] },
          ],
        },
        board,
      ),
      settings,
      "UTC",
    );
    expect(unused).toMatchObject({ feasible: true, unusedVehicles: 1 });

    const exactVehicleCountBoard: OrderBoard = {
      ...board,
      shipments: board.shipments.slice(0, 2),
    };
    const exactVehicleCount = await evaluateCandidate(
      exactVehicleCountBoard,
      parseCandidate(
        {
          routes: [
            {
              vehicleId: board.vehicles[0].id,
              shipmentIds: exactVehicleCountBoard.shipments.map(
                (item) => item.id,
              ),
            },
            { vehicleId: board.vehicles[1].id, shipmentIds: [] },
          ],
        },
        exactVehicleCountBoard,
      ),
      settings,
      "UTC",
    );
    expect(exactVehicleCount.unusedVehicles).toBe(1);

    const sparseBoard: OrderBoard = {
      ...board,
      shipments: [
        {
          ...board.shipments[0],
          deliveryWindows: [{ startMinute: 600, endMinute: 660 }],
        },
        board.shipments[3],
        { ...board.shipments[1], customerArchived: true },
      ],
    };
    const sparse = await evaluateCandidate(
      sparseBoard,
      parseCandidate(
        {
          routes: [
            {
              vehicleId: board.vehicles[0].id,
              shipmentIds: [board.shipments[0].id],
            },
            { vehicleId: board.vehicles[1].id, shipmentIds: [] },
          ],
        },
        sparseBoard,
      ),
      settings,
      "UTC",
    );
    expect(sparse).toMatchObject({
      unusedVehicles: 0,
      imbalanceSeconds: 0,
    });

    const lateBoard: OrderBoard = {
      ...board,
      shipments: board.shipments.map((item, index) =>
        index === 0
          ? {
              ...item,
              deliveryWindows: [{ startMinute: 60, endMinute: 120 }],
            }
          : item,
      ),
    };
    const late = await evaluateCandidate(
      lateBoard,
      parseCandidate(valid, lateBoard),
      settings,
      "UTC",
    );
    expect(late).toMatchObject({
      feasible: true,
      lateStops: 1,
      score: { lateSeconds: 21_600 },
    });
  });
});

describe("OpenAI private runtime configuration", () => {
  it("requires a key and an explicit deployment model", () => {
    expect(() => readOpenAIRoutingConfig({})).toThrow(
      "ROUTING_AI_CONFIG_MISSING",
    );
    expect(() =>
      readOpenAIRoutingConfig({ RUTAS_OPENAI_API_KEY: "secret" }),
    ).toThrow("ROUTING_AI_CONFIG_MISSING");
    expect(
      readOpenAIRoutingConfig({
        RUTAS_OPENAI_API_KEY: "secret",
        RUTAS_OPENAI_MODEL: "model",
      }),
    ).toEqual({
      apiKey: "secret",
      model: "model",
      organization: null,
      project: null,
      reasoningEffort: null,
    });
  });
  it.each(["none", "minimal", "low", "medium", "high", "xhigh", "max"])(
    "accepts the official reasoning effort %s",
    (reasoningEffort) => {
      expect(
        readOpenAIRoutingConfig({
          RUTAS_OPENAI_API_KEY: "key",
          RUTAS_OPENAI_MODEL: "model",
          RUTAS_OPENAI_REASONING_EFFORT: reasoningEffort,
        }).reasoningEffort,
      ).toBe(reasoningEffort);
    },
  );
  it("trims valid fields and rejects excessive untrusted values", () => {
    expect(
      readOpenAIRoutingConfig({
        RUTAS_OPENAI_API_KEY: " key ",
        RUTAS_OPENAI_MODEL: " model ",
        RUTAS_OPENAI_PROJECT_ID: " project ",
        RUTAS_OPENAI_REASONING_EFFORT: " HIGH ",
      }),
    ).toEqual({
      apiKey: "key",
      model: "model",
      organization: null,
      project: "project",
      reasoningEffort: "high",
    });
    expect(() =>
      readOpenAIRoutingConfig({
        RUTAS_OPENAI_API_KEY: "x".repeat(501),
        RUTAS_OPENAI_MODEL: "model",
      }),
    ).toThrow("ROUTING_AI_CONFIG_INVALID");
    expect(() =>
      readOpenAIRoutingConfig({
        RUTAS_OPENAI_API_KEY: "key",
        RUTAS_OPENAI_MODEL: "x".repeat(101),
      }),
    ).toThrow("ROUTING_AI_CONFIG_INVALID");
    expect(
      readOpenAIRoutingConfig({
        RUTAS_OPENAI_API_KEY: "k".repeat(500),
        RUTAS_OPENAI_MODEL: "m".repeat(100),
        RUTAS_OPENAI_ORGANIZATION_ID: ` ${"o".repeat(200)} `,
        RUTAS_OPENAI_PROJECT_ID: ` ${"p".repeat(200)} `,
      }),
    ).toEqual({
      apiKey: "k".repeat(500),
      model: "m".repeat(100),
      organization: "o".repeat(200),
      project: "p".repeat(200),
      reasoningEffort: null,
    });
    expect(() =>
      readOpenAIRoutingConfig({
        RUTAS_OPENAI_API_KEY: "key",
        RUTAS_OPENAI_MODEL: "model",
        RUTAS_OPENAI_ORGANIZATION_ID: "o".repeat(201),
      }),
    ).toThrow("ROUTING_AI_CONFIG_INVALID");
    expect(() =>
      readOpenAIRoutingConfig({
        RUTAS_OPENAI_API_KEY: "key",
        RUTAS_OPENAI_MODEL: "model",
        RUTAS_OPENAI_PROJECT_ID: "p".repeat(201),
      }),
    ).toThrow("ROUTING_AI_CONFIG_INVALID");
    expect(() =>
      readOpenAIRoutingConfig({
        RUTAS_OPENAI_API_KEY: "key",
        RUTAS_OPENAI_MODEL: "model",
        RUTAS_OPENAI_REASONING_EFFORT: "ultra",
      }),
    ).toThrow("ROUTING_AI_CONFIG_INVALID");
  });
});
