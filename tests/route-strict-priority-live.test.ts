import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/core/auth";
import { updateCustomer } from "../src/core/customers";
import { saveDeparture } from "../src/core/departure";
import { createVehicle } from "../src/core/fleet";
import { readFulfilledByOrderNames } from "../src/core/odoo";
import {
  orderBoard,
  persistImportPage,
  selectPlanVehicles,
} from "../src/core/orders";
import type { OrderBoard } from "../src/core/orders-contract";
import { createPlan } from "../src/core/plans";
import { planRouteDeterministically } from "../src/core/route-deterministic-planner";
import {
  buildDirectFleetRequest,
  expandDirectFleetResult,
  assertDirectFleetResponse,
  directFleetDiagnostics,
} from "../src/core/route-google-direct";
import { priorityConflictIds } from "../src/core/route-logistics-policy";
import {
  applyOptimizationResult,
  getPlanOptimization,
} from "../src/core/route-optimization";
import { acquireOptimizationLease } from "../src/core/route-optimization-lease";
import {
  parseGoogleOptimizationResponse,
  type GoogleOptimizationResult,
} from "../src/core/route-optimization-google";
import type { RoutingLogEntry } from "../src/core/route-observability";
import { createRoadLegReader } from "../src/core/route-road";
import {
  assertStrictPriorityResult,
  expandedRoutingCandidate,
} from "../src/core/route-strict-priority";
import { saveRoutingSettings } from "../src/core/routing-settings";
import type {
  RoutingSettings,
  PublicOptimizedRoute,
} from "../src/core/routing-contract";
import { startPostgres } from "./helpers/postgres";

const directory = process.env.RUTAS_QA_STRICT_PRIORITY_CAPTURE_DIRECTORY;

// Opt-in real integration: Odoo reads, Fleet, Routes, and isolated PostgreSQL.
// No substituted transport or solver result. source-projection.json records
// provenance and any explicitly configured local regression priorities.
describe.skipIf(!directory || !process.env.ODOO_URL)(
  "real strict-priority routing",
  () => {
    it("jointly allocates and orders the complete fleet natively, and persists once with version/concurrency guards", async () => {
      const captured: {
        board: OrderBoard;
        settings: RoutingSettings;
        timezone: string;
      } = JSON.parse(
        await readFile(`${directory}/source-projection.json`, "utf8"),
      );
      const imported = await readFulfilledByOrderNames(
        captured.board.shipments.map((s) => s.orderName),
      );
      expect(imported.shipments.map((s) => s.orderName).sort()).toEqual(
        captured.board.shipments.map((s) => s.orderName).sort(),
      );
      const db = await startPostgres();
      try {
        const actor = (
          await bootstrap(db.pool, db.config, {
            token: db.config.bootstrapToken,
            name: "QA prioridad real",
            login: randomUUID(),
            password: randomUUID(),
          })
        ).id;
        let plan = await createPlan(db.pool, actor, {
          date: captured.board.plan.service_date,
          label: "QA prioridad real",
        });
        const minute = captured.board.plan.departure_minute!;
        const clock = (m: number) => ({
          hour: Math.floor(m / 60),
          minute: m % 60,
        });
        plan = await saveDeparture(db.pool, actor, plan.id, {
          departureTime: `${String(clock(minute).hour).padStart(2, "0")}:${String(clock(minute).minute).padStart(2, "0")}`,
          expectedVersion: plan.version,
        });
        const settings = await saveRoutingSettings(db.pool, actor, {
          depotAddress: captured.settings.depotAddress,
          depotLocation: captured.settings.depotLocation,
          expectedVersion: 0,
        });
        for (const vehicle of captured.board.vehicles)
          await createVehicle(db.pool, actor, {
            id: vehicle.id,
            name: vehicle.name,
            brand: vehicle.brand || vehicle.name,
            model: vehicle.model || vehicle.name,
            plate: randomUUID().slice(0, 8),
            mileage: 0,
            fuel: "Gasolina",
            available: true,
          });
        await selectPlanVehicles(db.pool, actor, plan.id, {
          vehicleIds: captured.board.vehicles.map((v) => v.id),
          expectedVersion: plan.version,
        });
        await persistImportPage(db.pool, actor, plan.id, imported);
        const customers = (
          await db.pool.query(
            "SELECT id,version,odoo_partner_id FROM route_customers ORDER BY odoo_partner_id",
          )
        ).rows;
        for (const customer of customers) {
          const observed = captured.board.shipments.find(
            (s) => s.partnerId === Number(customer.odoo_partner_id),
          )!;
          expect(observed).toBeDefined();
          await updateCustomer(db.pool, actor, customer.id, {
            displayName: observed.customerName,
            phone: null,
            deliveryNote: "",
            fulfillmentMode: "delivery",
            deliveryAddress: imported.shipments.find(
              (s) => s.partnerId === observed.partnerId,
            )!.address,
            mapUrl: null,
            priority: observed.priority,
            unloadingMinutes: observed.unloadingMinutes,
            windows: observed.deliveryWindows.map((w) => ({
              start: clock(w.startMinute),
              end: clock(w.endMinute),
            })),
            location: {
              latitude: observed.latitude,
              longitude: observed.longitude,
              placeId: null,
            },
            expectedVersion: Number(customer.version),
          });
        }
        const before = await orderBoard(db.pool, plan.id);
        await writeFile(
          `${directory}/input-projection.json`,
          JSON.stringify({
            board: before,
            settings,
            timezone: captured.timezone,
          }),
        );
        const model = buildDirectFleetRequest(
          before,
          settings,
          captured.timezone,
        );
        let fleetCalls = 0,
          roadReads = 0;
        let raw: unknown;
        const logs: RoutingLogEntry[] = [];
        const road = createRoadLegReader();
        const begun = performance.now();
        const saved = await planRouteDeterministically(
          db.pool,
          actor,
          plan.id,
          { expectedVersion: before.plan.version },
          captured.timezone,
          {
            requestId: randomUUID(),
            logSink: (entry) => logs.push(entry),
            googleFetch: async (input, init) => {
              fleetCalls++;
              await expect(
                acquireOptimizationLease(
                  db.pool,
                  plan.id,
                  before.plan.version,
                  createHash("sha256")
                    .update("concurrent real QA")
                    .digest("hex"),
                  120,
                ),
              ).rejects.toThrow("ROUTING_ALREADY_RUNNING");
              await writeFile(
                `${directory}/strict-google-request.json`,
                String(init!.body),
              );
              const response = await fetch(input, init);
              if (!response.ok)
                await writeFile(
                  `${directory}/strict-google-error.json`,
                  JSON.stringify({
                    status: response.status,
                    payload: await response.clone().json(),
                  }),
                );
              if (response.ok) {
                raw = await response.clone().json();
                await writeFile(
                  `${directory}/strict-google-response.json`,
                  JSON.stringify(raw),
                );
              }
              return response;
            },
            readLeg: async (...args) => {
              roadReads++;
              await writeFile(
                `${directory}/strict-failed-stage.json`,
                JSON.stringify(logs),
              );
              const leg = await road(...args);
              return leg;
            },
          },
        );
        expect(saved).not.toBeNull();
        expect(fleetCalls).toBe(1);
        const parsed = parseGoogleOptimizationResponse(
          raw,
          model.groups.length,
          before.vehicles.length,
        );
        assertDirectFleetResponse(model.request, parsed);
        const initial = expandDirectFleetResult(
          before,
          model.groups,
          parsed,
          captured.timezone,
        );
        const current = await orderBoard(db.pool, plan.id);
        const final = {
          routes: saved!.routes.map((r) => ({
            vehicleId: r.vehicleId,
            shipmentIds: r.stops.map((s) => s.shipmentId),
          })),
        };
        const proposal = expandedRoutingCandidate(before, initial);
        expect(priorityConflictIds(before.shipments, final).size).toBe(0);
        for (const r of final.routes)
          expect([...r.shipmentIds].sort()).toEqual(
            [
              ...proposal.routes.find((p) => p.vehicleId === r.vehicleId)!
                .shipmentIds,
            ].sort(),
          );
        expect(saved!.metrics.performedShipmentCount).toBe(
          before.shipments.length,
        );
        expect(
          saved!.routes
            .flatMap((r) => r.stops)
            .every((s) => !s.priorityConflict),
        ).toBe(true);
        const stored = (
          await db.pool.query(
            "SELECT details FROM route_audit WHERE action='plan.optimized' AND entity_id=$1 ORDER BY id DESC LIMIT 1",
            [plan.id],
          )
        ).rows[0].details;
        expect(stored).toMatchObject({
          planner: "google-zones-v7-joint-priority",
          fleetRoutingRequests: 1,
          priorityScope: "per_vehicle",
          priorityEnforcement: "native_transition_horizon",
          pointOwnership: "native_same_vehicle_requirement",
          score: { priorityConflicts: 0 },
        });
        const changed: string[] = stored.reorderedVehicleIds;
        expect(changed).toEqual([]);
        expect(roadReads).toBe(0);
        expect(stored.providerSequencePreserved).toBe(true);
        for (const route of initial.routes) {
          const vehicleId = before.vehicles[route.vehicleIndex].id;
          if (!changed.includes(vehicleId)) {
            const retained = saved!.routes.find(
              (r) => r.vehicleId === vehicleId,
            )!;
            expect(retained.metrics).toEqual(route.metrics);
            expect(retained.departureAt).toBe(route.departureAt);
            expect(retained.finishedAt).toBe(route.finishedAt);
            expect(retained.stops.map((s) => s.eta)).toEqual(
              route.visits.map((s) => s.eta),
            );
          }
        }
        // Reconstruct the durable normalized result, including private traces,
        // for an authenticated HTTP/browser replay of this exact real receipt.
        const persisted = (
          await db.pool.query(
            "SELECT routes FROM route_optimization_runs WHERE plan_id=$1 ORDER BY created_at DESC LIMIT 1",
            [plan.id],
          )
        ).rows[0].routes as (PublicOptimizedRoute & {
          transitions: GoogleOptimizationResult["routes"][number]["transitions"];
        })[];
        const deliveries = before.shipments.filter(
          (s) => s.fulfillmentMode === "delivery" && !s.customerArchived,
        );
        const corrected: GoogleOptimizationResult = {
          metrics: saved!.metrics,
          skipped: [],
          routes: persisted.map((r) => ({
            ...r,
            vehicleIndex: before.vehicles.findIndex(
              (v) => v.id === r.vehicleId,
            ),
            visits: r.stops.map((s) => ({
              ...s,
              shipmentIndex: deliveries.findIndex((d) => d.id === s.shipmentId),
            })),
          })),
        };
        assertStrictPriorityResult(before, corrected);
        await writeFile(
          `${directory}/strict-result.json`,
          JSON.stringify(corrected),
        );
        await expect(
          planRouteDeterministically(
            db.pool,
            actor,
            plan.id,
            { expectedVersion: before.plan.version },
            captured.timezone,
          ),
        ).rejects.toThrow("VERSION_CONFLICT");
        await expect(
          applyOptimizationResult(
            db.pool,
            actor,
            plan.id,
            current.plan.version,
            settings.version + 1,
            before,
            before.shipments,
            createHash("sha256").update("stale QA").digest("hex"),
            corrected,
          ),
        ).rejects.toThrow("VERSION_CONFLICT");
        expect((await getPlanOptimization(db.pool, plan.id))!.runId).toBe(
          saved!.runId,
        );
        expect(
          (
            await db.pool.query(
              "SELECT count(*) FROM route_optimization_runs WHERE plan_id=$1",
              [plan.id],
            )
          ).rows[0].count,
        ).toBe("1");
        expect(
          (
            await db.pool.query(
              "SELECT count(*) FROM route_optimization_leases WHERE plan_id=$1",
              [plan.id],
            )
          ).rows[0].count,
        ).toBe("0");
        const diagnostic = directFleetDiagnostics(before, corrected);
        const summary = {
          policy: stored.planner,
          realFleetCalls: fleetCalls,
          roadLegReads: roadReads,
          reorderedVehicles: changed.length,
          elapsedMs: Math.round(performance.now() - begun),
          ...diagnostic,
        };
        await writeFile(
          `${directory}/strict-summary.json`,
          JSON.stringify(summary, null, 2),
        );
        await writeFile(`${directory}/strict-logs.json`, JSON.stringify(logs));
        console.log(JSON.stringify(summary));
      } finally {
        await db.close();
      }
    }, 300000);
  },
);
