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
  it("preserves Google's complete sequence including a priority exception, without LLM or extra road calls", async () => {
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
        {
          ...shipment,
          pickingId: 3,
          pickingName: "WH/OUT/3",
          orderId: 3,
          orderName: "S3",
          partnerId: 3,
          lines: [{ ...shipment.lines[0], moveId: 3, productId: 3 }],
        },
      ],
      nextCursor: 3,
      ceiling: 3,
      hasMore: false,
      inspected: 3,
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
      const effectiveAssignments = assignments.map(
        (assignment, index) => assignment ?? index % before.vehicles.length,
      );
      const routes = [0, 1].map((vehicleIndex) => {
        const visits = effectiveAssignments
          .flatMap((assignment, index) =>
            assignment === vehicleIndex
              ? [
                  {
                    shipmentIndex: index,
                    startTime: "2026-09-12T08:00:00Z",
                  },
                ]
              : [],
          )
          .reverse();
        return visits.length
          ? {
              vehicleIndex,
              vehicleStartTime: "2026-09-12T08:00:00Z",
              vehicleEndTime: "2026-09-12T08:00:00Z",
              visits,
              routePolyline: { points: "provider-route-polyline" },
              transitions: [...visits, null].map(() => ({
                routePolyline: { points: "provider-transition-polyline" },
                travelDistanceMeters: 0,
                travelDuration: "0s",
                waitDuration: "0s",
              })),
              metrics: {
                performedShipmentCount: visits.length,
                travelDistanceMeters: 0,
                travelDuration: "0s",
                waitDuration: "0s",
                totalDuration: "0s",
              },
            }
          : { vehicleIndex };
      });
      return new Response(
        JSON.stringify({
          routes,
          metrics: {
            aggregatedRouteMetrics: {
              performedShipmentCount: request.model.shipments.length,
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
        readLeg: async () => {
          throw new Error("Unexpected extra paid road call");
        },
        requestId: "routing-request-qa",
        logSink: (entry) => logs.push(entry),
      },
    );

    expect(googleCalls).toBe(1);
    expect(
      (
        googleRequests[0].model.shipments as {
          allowedVehicleIndices?: number[];
        }[]
      ).every((item) => item.allowedVehicleIndices === undefined),
    ).toBe(true);
    expect(googleRequests[0].model).not.toHaveProperty("precedenceRules");
    expect(googleRequests[0].injectedFirstSolutionRoutes).toBeUndefined();
    expect(googleRequests[0].model.transitionAttributes).toEqual([
      {
        srcTag: "priority:medium",
        dstTag: "priority:high",
        cost: expect.any(Number),
      },
    ]);
    expect(result).toMatchObject({
      current: true,
      metrics: { performedShipmentCount: 3 },
    });
    expect(
      result?.routes.map((route) => route.stops.length).sort((a, b) => a - b),
    ).toEqual([1, 2]);
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
      planner: "google-direct-v1-priority-transitions",
      evaluatedCandidates: 1,
      candidateSources: ["Google"],
      chosenSource: "Google",
      providerSequencePreserved: true,
      fleetRoutingRequests: 1,
      fleetRoutingRequestLimit: 1,
      fleetRoutingShipmentUnits: 3,
      logisticsPolicy: "google-direct-v1-priority-transitions",
      score: {
        priorityConflicts: 1,
        lateStops: 0,
        unusedVehicles: 0,
        maxOrders: 2,
        orderImbalance: 1,
      },
    });
    expect(logs.map((entry) => entry.system)).not.toContain(
      "OpenAI Responses API",
    );
    expect(logs.some((entry) => entry.event.startsWith("routing.openai"))).toBe(
      false,
    );
    expect(
      logs.filter((entry) => entry.event === "routing.google.started"),
    ).toHaveLength(1);
    expect(
      logs.some((entry) => entry.event.startsWith("routing.google.sequence")),
    ).toBe(false);
    expect(
      logs.find((entry) => entry.event === "routing.result.validated"),
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
      details: {
        assignedOrders: 3,
        skippedOrders: 0,
        fleetRoutingRequests: 1,
        fleetRoutingRequestLimit: 1,
        fleetRoutingShipmentUnits: 3,
      },
    });
    const serializedLogs = JSON.stringify(logs);
    expect(logs.some((entry) => entry.system === "Google Routes API")).toBe(
      false,
    );
    expect(result!.routes[0].stops.map((stop) => stop.shipmentId)).toEqual([
      before.shipments[2].id,
      before.shipments[0].id,
    ]);
    expect(result!.routes[0].encodedPolyline).toBe("provider-route-polyline");
    expect(result!.routes[0].segmentPolylines).toHaveLength(3);
    for (const privateValue of [
      "private_key",
      "Cliente privado",
      "warehouse-1",
      "warehouse-2",
      "warehouse-3",
    ])
      expect(serializedLogs).not.toContain(privateValue);

    const current = await orderBoard(db.pool, plan.id);
    const fallbackLogs: RoutingLogEntry[] = [];
    let rejectedOptimization = 0;
    const failingOptimizationFetch: typeof fetch = async () => {
      rejectedOptimization++;
      return new Response(JSON.stringify({ error: "provider unavailable" }), {
        status: 503,
      });
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
          googleFetch: failingOptimizationFetch,
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
      metrics: { performedShipmentCount: 3 },
    });
    expect(rejectedOptimization).toBe(1);
    expect(
      fallbackLogs.find(
        (entry) => entry.event === "routing.google.unavailable",
      ),
    ).toMatchObject({
      level: "warning",
      details: {
        errorCode: "ROUTING_GOOGLE_UNAVAILABLE",
        fleetRoutingRequests: 1,
        fleetRoutingRequestLimit: 1,
      },
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

  it("uses one direct Fleet Routing request even for one destination", async () => {
    let plan = await createPlan(db.pool, actor, {
      date: "2026-09-13",
      label: "Single stop Fleet budget QA",
    });
    plan = await saveDeparture(db.pool, actor, plan.id, {
      departureTime: "08:00",
      expectedVersion: plan.version,
    });
    const vehicle = await createVehicle(db.pool, actor, {
      id: randomUUID(),
      name: "Camioneta una parada",
      brand: "Ford",
      model: "2026",
      plate: `ONE-${randomUUID().slice(0, 8)}`,
      mileage: 0,
      fuel: "Gasolina",
      available: true,
    });
    await selectPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: [vehicle.id],
      expectedVersion: plan.version,
    });
    await persistImportPage(db.pool, actor, plan.id, {
      fingerprint: source,
      shipments: [
        {
          pickingId: 999,
          pickingName: "WH/OUT/999",
          orderId: 999,
          orderName: "S999",
          partnerId: 999,
          customerName: "Cliente una parada",
          address: "Bodega",
          validatedAt: "2026-09-13T08:00:00Z",
          promisedAt: null,
          backorderId: null,
          lines: [
            {
              moveId: 999,
              productId: 999,
              name: "Producto",
              quantity: 1,
              unit: "pieza",
            },
          ],
        },
      ],
      nextCursor: 1,
      ceiling: 1,
      hasMore: false,
      inspected: 1,
      excluded: 0,
    });
    const customer = (
      await db.pool.query(
        "SELECT id,version FROM route_customers WHERE source=$1 AND odoo_partner_id=999",
        [source],
      )
    ).rows[0];
    await updateCustomer(db.pool, actor, customer.id, {
      displayName: "Cliente una parada",
      phone: null,
      deliveryNote: "",
      priority: "high",
      fulfillmentMode: "delivery",
      deliveryAddress: "Punto único",
      mapUrl: null,
      location: { latitude: 20.1, longitude: -103, placeId: "single-stop" },
      windows: [],
      expectedVersion: Number(customer.version),
    });
    const before = await orderBoard(db.pool, plan.id);
    let googleCalls = 0;
    const logs: RoutingLogEntry[] = [];
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
        googleFetch: async () => {
          googleCalls++;
          return new Response(
            JSON.stringify({
              routes: [
                {
                  vehicleIndex: 0,
                  vehicleStartTime: "2026-09-13T08:00:00Z",
                  vehicleEndTime: "2026-09-13T08:00:00Z",
                  visits: [
                    {
                      shipmentIndex: 0,
                      startTime: "2026-09-13T08:00:00Z",
                    },
                  ],
                  transitions: [
                    {},
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
                },
              ],
              metrics: {
                aggregatedRouteMetrics: {
                  performedShipmentCount: 1,
                  travelDistanceMeters: 0,
                  travelDuration: "0s",
                  waitDuration: "0s",
                  totalDuration: "0s",
                },
              },
            }),
            { status: 200 },
          );
        },
        googleToken: async () => "google-token",
        readLeg: async () => {
          throw new Error("Unexpected extra road call");
        },
        requestId: "routing-single-stop-budget-qa",
        logSink: (entry) => logs.push(entry),
      },
    );
    expect(result?.metrics.performedShipmentCount).toBe(1);
    expect(googleCalls).toBe(1);
    expect(
      logs.find((entry) => entry.event === "routing.google.started"),
    ).toMatchObject({
      details: {
        fleetRoutingRequests: 1,
        fleetRoutingRequestLimit: 1,
        fleetRoutingShipmentUnits: 1,
      },
    });
    expect(logs.at(-1)).toMatchObject({
      event: "routing.completed",
      details: { fleetRoutingRequests: 1 },
    });
  });
});
