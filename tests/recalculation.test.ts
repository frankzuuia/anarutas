import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "../src/core/auth";
import { updateCustomer } from "../src/core/customers";
import { saveDeparture } from "../src/core/departure";
import { AppError } from "../src/core/errors";
import { createVehicle } from "../src/core/fleet";
import {
  moveShipment,
  orderBoard,
  persistImportPage,
  selectPlanVehicles,
} from "../src/core/orders";
import type { ImportPage, SourceShipment } from "../src/core/orders-contract";
import { createPlan } from "../src/core/plans";
import type { GoogleOptimizationResult } from "../src/core/route-optimization-google";
import {
  applyOptimizationResult,
  getPlanOptimization,
} from "../src/core/route-optimization";
import {
  claimRecalculation,
  failRecalculation,
  processRecalculation,
  retryRecalculation,
} from "../src/core/route-recalculation";
import {
  getRoutingSettings,
  saveRoutingSettings,
} from "../src/core/routing-settings";
import { startPostgres } from "./helpers/postgres";

let db: Awaited<ReturnType<typeof startPostgres>>, actor: string;
const source = createHash("sha256").update("recalculation-qa").digest("hex");
function sourceShipment(index: number): SourceShipment {
  return {
    pickingId: 100 + index,
    pickingName: `WH/OUT/${100 + index}`,
    orderId: 200 + index,
    orderName: `S${200 + index}`,
    partnerId: 300 + index,
    customerName: `Cliente ${index}`,
    address: "Bodega",
    validatedAt: "2026-09-10T08:00:00Z",
    promisedAt: null,
    backorderId: null,
    lines: [
      {
        moveId: 400 + index,
        productId: 500 + index,
        name: "Producto",
        quantity: 1,
        unit: "pieza",
      },
    ],
  };
}
function page(shipments: SourceShipment[]): ImportPage {
  return {
    fingerprint: source,
    shipments,
    nextCursor: shipments.length,
    ceiling: shipments.length,
    hasMore: false,
    inspected: shipments.length,
    excluded: 0,
  };
}

beforeAll(async () => {
  db = await startPostgres();
  actor = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "Recálculo QA",
      login: "recalculo-qa",
      password: randomUUID(),
    })
  ).id;
});
afterAll(async () => {
  await db?.close();
});

describe("durable recalculation / real PostgreSQL and zero-distance road case", () => {
  it("preserves a manual order and replaces stale geometry without redistributing", async () => {
    await saveRoutingSettings(db.pool, actor, {
      depotAddress: "Bodega QA",
      depotLocation: { latitude: 20, longitude: -103, placeId: "warehouse" },
      expectedVersion: 0,
    });
    let plan = await createPlan(db.pool, actor, {
      date: "2026-09-10",
      label: "Recálculo",
    });
    plan = await saveDeparture(db.pool, actor, plan.id, {
      departureTime: "08:00",
      expectedVersion: plan.version,
    });
    const vehicle = await createVehicle(db.pool, actor, {
      id: randomUUID(),
      name: "Camioneta recálculo",
      brand: "Ford",
      model: "2026",
      plate: "RECAL-QA",
      mileage: 0,
      fuel: "Gasolina",
      available: true,
    });
    await selectPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: [vehicle.id],
      expectedVersion: plan.version,
    });
    await persistImportPage(
      db.pool,
      actor,
      plan.id,
      page([sourceShipment(1), sourceShipment(2)]),
    );
    const customers = await db.pool.query(
      "SELECT id,version FROM route_customers WHERE source=$1 ORDER BY odoo_partner_id",
      [source],
    );
    for (const [index, customer] of customers.rows.entries())
      await updateCustomer(db.pool, actor, customer.id, {
        displayName: `Cliente ${index + 1}`,
        phone: null,
        deliveryNote: "",
        priority: index ? "medium" : "high",
        fulfillmentMode: "delivery",
        deliveryAddress: "Bodega QA",
        mapUrl: null,
        location: { latitude: 20, longitude: -103, placeId: `same-${index}` },
        windows: [
          {
            days: [0, 1, 2, 3, 4, 5, 6],
            start: { hour: 8, minute: 0 },
            end: { hour: 17, minute: 0 },
          },
        ],
        expectedVersion: Number(customer.version),
      });
    const before = await orderBoard(db.pool, plan.id),
      deliveries = before.shipments;
    const zero = {
      travelDistanceMeters: 0,
      travelDurationSeconds: 0,
      waitDurationSeconds: 0,
      totalDurationSeconds: 0,
      performedShipmentCount: 2,
    };
    const result: GoogleOptimizationResult = {
      routes: [
        {
          vehicleIndex: 0,
          encodedPolyline: "initial",
          metrics: zero,
          visits: deliveries.map((_, shipmentIndex) => ({
            shipmentIndex,
            eta: "2026-09-10T08:00:00Z",
            travelDistanceMeters: 0,
            travelDurationSeconds: 0,
            waitDurationSeconds: 0,
          })),
          transitions: [],
        },
      ],
      skipped: [],
      metrics: zero,
    };
    await applyOptimizationResult(
      db.pool,
      actor,
      plan.id,
      before.plan.version,
      (await getRoutingSettings(db.pool)).version,
      before,
      deliveries,
      createHash("sha256").update("initial-recalculation").digest("hex"),
      result,
    );
    const applied = await orderBoard(db.pool, plan.id),
      original = applied.shipments.map((s) => s.id);
    await moveShipment(db.pool, actor, plan.id, {
      shipmentId: original[0],
      vehicleId: vehicle.id,
      beforeId: null,
      expectedVersion: applied.plan.version,
    });
    expect(
      (await orderBoard(db.pool, plan.id)).shipments.map((s) => s.id),
    ).toEqual([original[1], original[0]]);
    expect((await getPlanOptimization(db.pool, plan.id))?.current).toBe(false);
    await db.pool.query(
      "UPDATE route_recalculation_jobs SET available_at=now() WHERE plan_id=$1",
      [plan.id],
    );
    expect(await processRecalculation(db.pool, "UTC")).toBe(true);
    expect(
      (await orderBoard(db.pool, plan.id)).shipments.map((s) => s.id),
    ).toEqual([original[1], original[0]]);
    const current = await getPlanOptimization(db.pool, plan.id);
    expect(current).toMatchObject({
      current: true,
      recalculation: null,
      routes: [
        {
          vehicleId: vehicle.id,
          departureAt: "2026-09-10T08:00:00.000Z",
          finishedAt: "2026-09-10T08:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(current)).not.toContain("routeToken");
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM route_audit WHERE action='plan.recalculated' AND entity_id=$1",
          [plan.id],
        )
      ).rows[0].count,
    ).toBe(1);

    const fresh = await orderBoard(db.pool, plan.id);
    await moveShipment(db.pool, actor, plan.id, {
      shipmentId: original[0],
      vehicleId: vehicle.id,
      beforeId: original[1],
      expectedVersion: fresh.plan.version,
    });
    await db.pool.query(
      "UPDATE route_recalculation_jobs SET available_at=now() WHERE plan_id=$1",
      [plan.id],
    );
    const transient = await claimRecalculation(db.pool);
    expect(transient).not.toBeNull();
    await failRecalculation(
      db.pool,
      transient!,
      new AppError("ROUTING_GOOGLE_QUOTA", 503),
    );
    expect(
      (
        await db.pool.query(
          "SELECT status,error_code FROM route_recalculation_jobs WHERE plan_id=$1",
          [plan.id],
        )
      ).rows[0],
    ).toEqual({ status: "pending", error_code: "ROUTING_GOOGLE_QUOTA" });
    await db.pool.query(
      "UPDATE route_recalculation_jobs SET available_at=now() WHERE plan_id=$1",
      [plan.id],
    );
    const permanent = await claimRecalculation(db.pool);
    await failRecalculation(
      db.pool,
      permanent!,
      new AppError("ROUTING_ROADS_CONFIG_MISSING", 503),
    );
    expect(
      (
        await db.pool.query(
          "SELECT status FROM route_recalculation_jobs WHERE plan_id=$1",
          [plan.id],
        )
      ).rows[0].status,
    ).toBe("failed");
    await retryRecalculation(db.pool, actor, plan.id);
    expect(
      (
        await db.pool.query(
          "SELECT status,error_code FROM route_recalculation_jobs WHERE plan_id=$1",
          [plan.id],
        )
      ).rows[0],
    ).toEqual({ status: "pending", error_code: null });
  });

  it("does not create a retry job for a plan that has never been calculated", async () => {
    const plan = await createPlan(db.pool, actor, {
      date: "2026-09-11",
      label: "Sin cálculo",
    });
    await expect(retryRecalculation(db.pool, actor, plan.id)).rejects.toThrow(
      "ROUTING_NOT_CALCULATED",
    );
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM route_recalculation_jobs WHERE plan_id=$1",
          [plan.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
});
