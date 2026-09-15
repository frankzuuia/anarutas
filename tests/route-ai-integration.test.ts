import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "../src/core/auth";
import { updateCustomer } from "../src/core/customers";
import { saveDeparture } from "../src/core/departure";
import { createVehicle } from "../src/core/fleet";
import {
  orderBoard,
  persistImportPage,
  selectPlanVehicles,
} from "../src/core/orders";
import type { ImportPage, SourceShipment } from "../src/core/orders-contract";
import { createPlan } from "../src/core/plans";
import { planRouteDeterministically } from "../src/core/route-deterministic-planner";
import type { GoogleOptimizationRequest } from "../src/core/route-optimization-google";
import type { RoutingLogEntry } from "../src/core/route-observability";
import { saveRoutingSettings } from "../src/core/routing-settings";
import { startPostgres } from "./helpers/postgres";

let db: Awaited<ReturnType<typeof startPostgres>>;
let actor: string;
const source = createHash("sha256")
  .update("deterministic-routing-contract-qa")
  .digest("hex");

beforeAll(async () => {
  db = await startPostgres();
  actor = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "Routing QA",
      login: "routing-qa",
      password: randomUUID(),
    })
  ).id;
});

afterAll(async () => {
  await db?.close();
});

describe("deterministic Google routing with real PostgreSQL", () => {
  it("uses no LLM and replaces a concentrated Google proposal with the best complete measured candidate", async () => {
    await saveRoutingSettings(db.pool, actor, {
      depotAddress: "Bodega",
      depotLocation: { latitude: 20, longitude: -103, placeId: "warehouse" },
      expectedVersion: 0,
    });
    let plan = await createPlan(db.pool, actor, {
      date: "2026-09-12",
      label: "Deterministic QA",
    });
    plan = await saveDeparture(db.pool, actor, plan.id, {
      departureTime: "08:00",
      expectedVersion: plan.version,
    });
    const vehicles = [];
    for (const index of [1, 2])
      vehicles.push(
        await createVehicle(db.pool, actor, {
          id: randomUUID(),
          name: `Camioneta ${index}`,
          brand: "Ford",
          model: "2026",
          plate: `ROUTING-QA-${index}`,
          mileage: 0,
          fuel: "Gasolina",
          available: true,
        }),
      );
    await selectPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: vehicles.map((vehicle) => vehicle.id),
      expectedVersion: plan.version,
    });
    const shipment: SourceShipment = {
      pickingId: 1,
      pickingName: "WH/OUT/1",
      orderId: 1,
      orderName: "S1",
      partnerId: 1,
      customerName: "Cliente privado",
      address: "Bodega",
      validatedAt: "2026-09-12T08:00:00Z",
      promisedAt: null,
      backorderId: null,
      lines: [
        {
          moveId: 1,
          productId: 1,
          name: "Producto",
          quantity: 1,
          unit: "pieza",
        },
      ],
    };
    const page: ImportPage = {
      fingerprint: source,
      shipments: [
        shipment,
        {
          ...shipment,
          pickingId: 2,
          pickingName: "WH/OUT/2",
          orderId: 2,
          orderName: "S2",
          partnerId: 2,
          lines: [{ ...shipment.lines[0], moveId: 2, productId: 2 }],
        },
      ],
      nextCursor: 2,
      ceiling: 2,
      hasMore: false,
      inspected: 2,
      excluded: 0,
    };
    await persistImportPage(db.pool, actor, plan.id, page);
    const customers = (
      await db.pool.query(
        "SELECT id,version,odoo_partner_id FROM route_customers WHERE source=$1 ORDER BY odoo_partner_id",
        [source],
      )
    ).rows;
    for (const customer of customers)
      await updateCustomer(db.pool, actor, customer.id, {
        displayName: `Cliente ${customer.odoo_partner_id}`,
        phone: null,
        deliveryNote: "",
        priority: Number(customer.odoo_partner_id) === 1 ? "high" : "medium",
        fulfillmentMode: "delivery",
        deliveryAddress: "Bodega",
        mapUrl: null,
        location: {
          latitude: 20 + (Number(customer.odoo_partner_id) - 1) * 0.01,
          longitude: -103,
          placeId: `warehouse-${customer.odoo_partner_id}`,
        },
        windows: [],
        expectedVersion: Number(customer.version),
      });

    const before = await orderBoard(db.pool, plan.id);
    let googleCalls = 0;
    const googleRequests: GoogleOptimizationRequest[] = [];
    const logs: RoutingLogEntry[] = [];
    const googleFetch: typeof fetch = async (input, init) => {
      googleCalls++;
      expect(String(input)).toContain(
        "routeoptimization.googleapis.com/v1/projects/qa-project:optimizeTours",
      );
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer google-token",
      );
      const request = JSON.parse(
        String(init?.body),
      ) as GoogleOptimizationRequest;
      googleRequests.push(request);
      expect(request.searchMode).toBe("CONSUME_ALL_AVAILABLE_TIME");
      expect(request.model.globalDurationCostPerHour).toBeGreaterThan(0);
      expect(JSON.stringify(request)).toContain("loadDemands");
      expect(JSON.stringify(request)).not.toContain("OpenAI");
      const assignments = request.model.shipments.map(
        (item: { allowedVehicleIndices?: number[] }) =>
          item.allowedVehicleIndices?.[0],
      );
      const split =
        assignments.every((assignment) => assignment !== undefined) &&
        assignments[0] !== assignments[1];
      const routes = split
        ? [0, 1].map((vehicleIndex) => ({
            vehicleIndex,
            vehicleStartTime: "2026-09-12T08:00:00Z",
            vehicleEndTime: "2026-09-12T08:00:00Z",
            visits: [
              {
                shipmentIndex: assignments.indexOf(vehicleIndex),
                startTime: "2026-09-12T08:00:00Z",
              },
            ],
            transitions: [
              {
                travelDistanceMeters: 0,
                travelDuration: "0s",
                waitDuration: "0s",
              },
            ],
            metrics: {
              performedShipmentCount: 1,
              travelDistanceMeters: 0,
              travelDuration: "0s",
              waitDuration: "0s",
              totalDuration: "0s",
            },
          }))
        : [
            {
              vehicleIndex: 0,
              vehicleStartTime: "2026-09-12T08:00:00Z",
              vehicleEndTime: "2026-09-12T08:00:00Z",
              visits:
                assignments[0] === 0
                  ? [
                      {
                        shipmentIndex: 0,
                        startTime: "2026-09-12T08:00:00Z",
                      },
                      {
                        shipmentIndex: 1,
                        startTime: "2026-09-12T08:00:00Z",
                      },
                    ]
                  : [
                      {
                        shipmentIndex: 1,
                        startTime: "2026-09-12T08:00:00Z",
                      },
                      {
                        shipmentIndex: 0,
                        startTime: "2026-09-12T08:00:00Z",
                      },
                    ],
              transitions: [
                {
                  travelDistanceMeters: 0,
                  travelDuration: "0s",
                  waitDuration: "0s",
                },
                {
                  travelDistanceMeters: 0,
                  travelDuration: "0s",
                  waitDuration: "0s",
                },
              ],
              metrics: {
                performedShipmentCount: 2,
                travelDistanceMeters: 0,
                travelDuration: "0s",
                waitDuration: "0s",
                totalDuration: "0s",
              },
            },
            { vehicleIndex: 1 },
          ];
      return new Response(
        JSON.stringify({
          routes,
          metrics: {
            aggregatedRouteMetrics: {
              performedShipmentCount: 2,
              travelDistanceMeters: 0,
              travelDuration: "0s",
              waitDuration: "0s",
              totalDuration: "0s",
            },
          },
        }),
        { status: 200 },
      );
    };

    const result = await planRouteDeterministically(
      db.pool,
      actor,
      plan.id,
      { expectedVersion: before.plan.version },
      "UTC",
      {
        googleConfig: {
          projectId: "qa-project",
          credentials: {
            type: "service_account",
            project_id: "qa-project",
            client_email: "qa@qa-project.iam.gserviceaccount.com",
            private_key: "unused by injected token",
            token_uri: "https://oauth2.googleapis.com/token",
          },
        },
        googleFetch,
        googleToken: async () => "google-token",
        readLeg: async () => ({
          distance: 100,
          seconds: 10,
          polyline: "integration-road",
          token: null,
          trafficMode: "forecast",
        }),
        requestId: "routing-request-qa",
        logSink: (entry) => logs.push(entry),
      },
    );

    expect(googleCalls).toBe(4);
    expect(
      (
        googleRequests[0].model.shipments as {
          allowedVehicleIndices?: number[];
        }[]
      ).every((item) => item.allowedVehicleIndices === undefined),
    ).toBe(true);
    expect(googleRequests[0].model).not.toHaveProperty("precedenceRules");
    expect(
      googleRequests[1].model.shipments.map(
        (item) => item.allowedVehicleIndices!,
      ),
    ).toEqual([[0], [0]]);
    expect(googleRequests[1].model.precedenceRules).toEqual([
      expect.objectContaining({ firstIndex: 0, secondIndex: 1 }),
    ]);
    const geographicAssignments = googleRequests[2].model.shipments.map(
      (item) => item.allowedVehicleIndices!,
    );
    expect(geographicAssignments).toHaveLength(2);
    expect(new Set(geographicAssignments.flat()).size).toBe(2);
    expect(googleRequests[2].model).not.toHaveProperty("precedenceRules");
    expect(
      googleRequests[3].model.shipments.every(
        (item) => item.allowedVehicleIndices === undefined,
      ),
    ).toBe(true);
    expect(googleRequests[3].model).not.toHaveProperty("precedenceRules");
    expect(googleRequests[3].injectedFirstSolutionRoutes).toHaveLength(2);
    expect(result).toMatchObject({
      current: true,
      metrics: { performedShipmentCount: 2 },
    });
    expect(result?.routes.map((route) => route.stops.length)).toEqual([1, 1]);
    expect(
      new Set(
        (await orderBoard(db.pool, plan.id)).shipments.map(
          (item) => item.vehicle_id,
        ),
      ),
    ).toEqual(new Set(before.vehicles.map((vehicle) => vehicle.id)));
    const audit = (
      await db.pool.query(
        "SELECT details FROM route_audit WHERE action='plan.optimized' AND entity_id=$1 ORDER BY id DESC LIMIT 1",
        [plan.id],
      )
    ).rows[0].details;
    expect(audit).toMatchObject({
      planner: "google-deterministic-v3",
      evaluatedCandidates: 2,
      candidateSources: ["Google", "balance"],
      chosenSource: "balance",
      logisticsPolicy: "priority-geographic-refined-v9",
      score: {
        priorityConflicts: 0,
        lateStops: 0,
        unusedVehicles: 0,
        maxOrders: 1,
        orderImbalance: 0,
      },
    });
    expect(logs.map((entry) => entry.system)).not.toContain(
      "OpenAI Responses API",
    );
    expect(logs.some((entry) => entry.event.startsWith("routing.openai"))).toBe(
      false,
    );
    expect(
      logs.filter(
        (entry) => entry.event === "routing.google.sequence.completed",
      ),
    ).toHaveLength(2);
    expect(
      logs.find(
        (entry) => entry.event === "routing.google.refinement.duplicate",
      ),
    ).toBeDefined();
    expect(
      logs.find((entry) => entry.event === "routing.logistics.compared"),
    ).toMatchObject({
      details: {
        operationalSeconds: expect.any(Number),
        travelSeconds: expect.any(Number),
        makespanSeconds: expect.any(Number),
        distanceMeters: expect.any(Number),
      },
    });
    expect(logs.at(-1)).toMatchObject({
      event: "routing.completed",
      system: "PostgreSQL",
      details: { assignedOrders: 2, skippedOrders: 0 },
    });
    const serializedLogs = JSON.stringify(logs);
    for (const privateValue of [
      "private_key",
      "Cliente privado",
      "warehouse-1",
      "warehouse-2",
    ])
      expect(serializedLogs).not.toContain(privateValue);

    const current = await orderBoard(db.pool, plan.id);
    const fallbackLogs: RoutingLogEntry[] = [];
    let rejectedRefinements = 0;
    const failingRefinementFetch: typeof fetch = async (input, init) => {
      const request = JSON.parse(
        String(init?.body),
      ) as GoogleOptimizationRequest;
      if (request.injectedFirstSolutionRoutes) {
        rejectedRefinements++;
        return new Response(JSON.stringify({ error: "provider unavailable" }), {
          status: 503,
        });
      }
      return googleFetch(input, init);
    };
    await expect(
      planRouteDeterministically(
        db.pool,
        actor,
        plan.id,
        { expectedVersion: current.plan.version },
        "UTC",
        {
          googleConfig: {
            projectId: "qa-project",
            credentials: {
              type: "service_account",
              project_id: "qa-project",
              client_email: "qa@qa-project.iam.gserviceaccount.com",
              private_key: "unused by injected token",
              token_uri: "https://oauth2.googleapis.com/token",
            },
          },
          googleFetch: failingRefinementFetch,
          googleToken: async () => "google-token",
          readLeg: async () => ({
            distance: 100,
            seconds: 10,
            polyline: "integration-road",
            token: null,
            trafficMode: "forecast",
          }),
          requestId: "routing-refinement-fallback-qa",
          logSink: (entry) => fallbackLogs.push(entry),
        },
      ),
    ).resolves.toMatchObject({
      current: true,
      metrics: { performedShipmentCount: 2 },
    });
    expect(rejectedRefinements).toBe(1);
    expect(
      fallbackLogs.find(
        (entry) => entry.event === "routing.google.refinement.unavailable",
      ),
    ).toMatchObject({
      level: "warning",
      details: { errorCode: "ROUTING_GOOGLE_UNAVAILABLE" },
    });
    expect(fallbackLogs.at(-1)?.event).toBe("routing.completed");

    const failedLogs: RoutingLogEntry[] = [];
    await expect(
      planRouteDeterministically(
        db.pool,
        actor,
        plan.id,
        { expectedVersion: before.plan.version },
        "UTC",
        {
          requestId: "routing-failed-qa",
          logSink: (entry) => failedLogs.push(entry),
        },
      ),
    ).rejects.toThrow("VERSION_CONFLICT");
    expect(failedLogs.at(-1)).toMatchObject({
      event: "routing.failed",
      level: "error",
      details: { errorCode: "VERSION_CONFLICT" },
    });
  });
});
