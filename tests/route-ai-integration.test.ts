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
import { planRouteWithOpenAI } from "../src/core/route-ai-planner";
import { saveRoutingSettings } from "../src/core/routing-settings";
import { startPostgres } from "./helpers/postgres";

let db: Awaited<ReturnType<typeof startPostgres>>, actor: string;
const source = createHash("sha256")
  .update("openai-tools-contract-qa")
  .digest("hex");
beforeAll(async () => {
  db = await startPostgres();
  actor = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "OpenAI QA",
      login: "openai-qa",
      password: randomUUID(),
    })
  ).id;
});
afterAll(async () => {
  await db?.close();
});

describe("OpenAI native tools orchestration / provider contract fixture and real PostgreSQL", () => {
  it("compares a distinct multi-vehicle alternative and commits only the best candidate ID", async () => {
    await saveRoutingSettings(db.pool, actor, {
      depotAddress: "Bodega",
      depotLocation: { latitude: 20, longitude: -103, placeId: "warehouse" },
      expectedVersion: 0,
    });
    let plan = await createPlan(db.pool, actor, {
      date: "2026-09-12",
      label: "IA QA",
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
          name: `IA camioneta ${index}`,
          brand: "Ford",
          model: "2026",
          plate: `OPENAI-QA-${index}`,
          mileage: 0,
          fuel: "Gasolina",
          available: true,
        }),
      );
    await selectPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: vehicles.map((vehicle) => vehicle.id),
      expectedVersion: plan.version,
    });
    const sourceShipment: SourceShipment = {
      pickingId: 1,
      pickingName: "WH/OUT/1",
      orderId: 1,
      orderName: "S1",
      partnerId: 1,
      customerName: "Cliente",
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
    const secondSourceShipment: SourceShipment = {
      ...sourceShipment,
      pickingId: 2,
      pickingName: "WH/OUT/2",
      orderId: 2,
      orderName: "S2",
      partnerId: 2,
      customerName: "PII segundo cliente",
      lines: [{ ...sourceShipment.lines[0], moveId: 2, productId: 2 }],
    };
    const page: ImportPage = {
      fingerprint: source,
      shipments: [sourceShipment, secondSourceShipment],
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
          latitude: 20,
          longitude: -103,
          placeId: `same-as-warehouse-${customer.odoo_partner_id}`,
        },
        windows: [],
        expectedVersion: Number(customer.version),
      });
    const before = await orderBoard(db.pool, plan.id);
    let openAICalls = 0,
      googleCalls = 0,
      selectedCandidateId = "";
    const openAIFetch: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://api.openai.com/v1/responses");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer test-key",
      );
      const request = JSON.parse(String(init?.body));
      expect(request).not.toHaveProperty("max_output_tokens");
      expect(request.reasoning).toEqual({ effort: "high" });
      expect(JSON.stringify(request)).not.toContain("PII segundo cliente");
      expect(
        request.tools.every((tool: { strict?: boolean }) => tool.strict),
      ).toBe(true);
      openAICalls++;
      if (openAICalls === 1)
        return new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "function_call",
                name: "get_google_proposal",
                arguments: "{}",
                call_id: "google-call",
              },
            ],
          }),
          { status: 200 },
        );
      if (openAICalls === 2) {
        const snapshot = JSON.parse(request.input[0].content[0].text);
        expect(snapshot.minimumDistinctCandidates).toBe(2);
        const googleOutput = JSON.parse(
          request.input
            .filter(
              (item: { type?: string }) => item.type === "function_call_output",
            )
            .at(-1).output,
        );
        expect(googleOutput).toMatchObject({
          evaluated: false,
          error: "ROUTING_AI_PRIORITY_INVALID",
        });
        return new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "function_call",
                name: "evaluate_candidate",
                arguments: JSON.stringify({
                  routes: [
                    {
                      vehicleId: before.vehicles[0].id,
                      shipmentIds: [before.shipments[0].id],
                    },
                    {
                      vehicleId: before.vehicles[1].id,
                      shipmentIds: [before.shipments[1].id],
                    },
                  ],
                }),
                call_id: "evaluate-call",
              },
            ],
          }),
          { status: 200 },
        );
      }
      const toolOutput = request.input
        .filter(
          (item: { type?: string }) => item.type === "function_call_output",
        )
        .at(-1);
      if (openAICalls === 3) {
        selectedCandidateId = JSON.parse(toolOutput.output).candidateId;
        return new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "function_call",
                name: "evaluate_candidate",
                arguments: JSON.stringify({
                  routes: [
                    {
                      vehicleId: before.vehicles[0].id,
                      shipmentIds: [before.shipments[0].id],
                    },
                    {
                      vehicleId: before.vehicles[1].id,
                      shipmentIds: [before.shipments[1].id],
                    },
                  ],
                }),
                call_id: "duplicate-evaluate-call",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (openAICalls === 4) {
        expect(JSON.parse(toolOutput.output).candidateId).toBe(
          selectedCandidateId,
        );
        return new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "function_call",
                name: "commit_candidate",
                arguments: JSON.stringify({
                  candidateId: selectedCandidateId,
                }),
                call_id: "early-commit-call",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (openAICalls === 5) {
        expect(JSON.parse(toolOutput.output)).toMatchObject({
          committed: false,
          error: "Evaluate at least 2 distinct complete candidates.",
        });
        return new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "function_call",
                name: "evaluate_candidate",
                arguments: JSON.stringify({
                  routes: [
                    {
                      vehicleId: before.vehicles[0].id,
                      shipmentIds: before.shipments.map(
                        (shipment) => shipment.id,
                      ),
                    },
                    {
                      vehicleId: before.vehicles[1].id,
                      shipmentIds: [],
                    },
                  ],
                }),
                call_id: "evaluate-unbalanced-call",
              },
            ],
          }),
          { status: 200 },
        );
      }
      expect(JSON.parse(toolOutput.output)).toMatchObject({
        feasible: false,
        unusedVehicles: 1,
      });
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "function_call",
              name: "commit_candidate",
              arguments: JSON.stringify({ candidateId: selectedCandidateId }),
              call_id: "commit-call",
            },
          ],
        }),
        { status: 200 },
      );
    };
    const googleFetch: typeof fetch = async (input, init) => {
      googleCalls++;
      expect(String(input)).toContain(
        "routeoptimization.googleapis.com/v1/projects/qa-project:optimizeTours",
      );
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer google-token",
      );
      return new Response(
        JSON.stringify({
          routes: [
            {
              vehicleIndex: 0,
              vehicleStartTime: "2026-09-12T08:00:00Z",
              vehicleEndTime: "2026-09-12T08:00:00Z",
              visits: [
                { shipmentIndex: 1, startTime: "2026-09-12T08:00:00Z" },
                { shipmentIndex: 0, startTime: "2026-09-12T08:00:00Z" },
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
          ],
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
    const result = await planRouteWithOpenAI(
      db.pool,
      actor,
      plan.id,
      { expectedVersion: before.plan.version },
      "UTC",
      {
        openAIConfig: {
          apiKey: "test-key",
          model: "test-model",
          organization: null,
          project: null,
          reasoningEffort: "high",
        },
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
        openAIFetch,
        googleFetch,
        googleToken: async () => "google-token",
      },
    );
    expect(openAICalls).toBe(6);
    expect(googleCalls).toBe(1);
    expect(result).toMatchObject({
      current: true,
      metrics: { performedShipmentCount: 2 },
      routes: [
        {
          vehicleId: before.vehicles[0].id,
          departureAt: "2026-09-12T08:00:00.000Z",
          finishedAt: "2026-09-12T08:00:00.000Z",
        },
        {
          vehicleId: before.vehicles[1].id,
          departureAt: "2026-09-12T08:00:00.000Z",
          finishedAt: "2026-09-12T08:00:00.000Z",
        },
      ],
    });
    expect(
      (await orderBoard(db.pool, plan.id)).shipments.map(
        (shipment) => shipment.vehicle_id,
      ),
    ).toEqual(before.vehicles.map((vehicle) => vehicle.id));
    const audit = (
      await db.pool.query(
        "SELECT details FROM route_audit WHERE action='plan.optimized' AND entity_id=$1 ORDER BY id DESC LIMIT 1",
        [plan.id],
      )
    ).rows[0].details;
    expect(audit).toMatchObject({
      planner: "openai-native-tools",
      model: "test-model",
      reasoningEffort: "high",
      toolCalls: 6,
      evaluatedCandidates: 2,
    });
  });
});
