import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "../src/core/auth";
import { migrate } from "../src/core/database";
import { updateCustomer } from "../src/core/customers";
import { saveDeparture } from "../src/core/departure";
import { AppError } from "../src/core/errors";
import { assignDriver, createDriver, createVehicle } from "../src/core/fleet";
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
  manualRecalculationStatus,
  processRecalculation,
  requestManualRecalculation,
  retryRecalculation,
} from "../src/core/route-recalculation";
import {
  getRoutingSettings,
  saveRoutingSettings,
} from "../src/core/routing-settings";
import { routeFingerprint } from "../src/core/route-fingerprint";
import { publishRoutes } from "../src/core/route-publications";
import { startDriverRoute } from "../src/core/route-start";
import { uploadDriverUnitPhoto } from "../src/core/unit-photos";
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
  it("calculates the first manual route on explicit publish confirmation and retains stop order", async () => {
    const settings = await getRoutingSettings(db.pool);
    await saveRoutingSettings(db.pool, actor, {
      depotAddress: "Bodega de ruta manual",
      depotLocation: { latitude: 20, longitude: -103, placeId: "manual-depot" },
      expectedVersion: settings.version,
    });
    let plan = await createPlan(db.pool, actor, {
      date: "2026-09-23",
      label: "Primera ruta manual",
    });
    plan = await saveDeparture(db.pool, actor, plan.id, {
      departureTime: "08:00",
      expectedVersion: plan.version,
    });
    const driver = await createDriver(db.pool, actor, {
      id: randomUUID(),
      name: "Chofer manual",
      phone: "3311111199",
      emergency_name: "",
      emergency_phone: "",
      blood_type: "",
      active: true,
    });
    const vehicle = await createVehicle(db.pool, actor, {
      id: randomUUID(),
      name: "Camioneta manual",
      brand: "Ford",
      model: "2026",
      plate: `MAN-${randomUUID().slice(0, 8)}`,
      mileage: 0,
      fuel: "Gasolina",
      available: true,
    });
    await assignDriver(db.pool, actor, vehicle.id, {
      driver_id: driver.id,
      expectedVersion: vehicle.version,
    });
    await selectPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: [vehicle.id],
      expectedVersion: plan.version,
    });
    await persistImportPage(
      db.pool,
      actor,
      plan.id,
      page([sourceShipment(900), sourceShipment(901)]),
    );
    let board = await orderBoard(db.pool, plan.id);
    const [first, second] = board.shipments;
    await moveShipment(db.pool, actor, plan.id, {
      shipmentId: second.id,
      vehicleId: vehicle.id,
      beforeId: null,
      expectedVersion: board.plan.version,
    });
    board = await orderBoard(db.pool, plan.id);
    await moveShipment(db.pool, actor, plan.id, {
      shipmentId: first.id,
      vehicleId: vehicle.id,
      beforeId: null,
      expectedVersion: board.plan.version,
    });
    board = await orderBoard(db.pool, plan.id);
    expect(board.shipments.map((item) => item.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(await getPlanOptimization(db.pool, plan.id)).toBeNull();
    await expect(
      requestManualRecalculation(db.pool, actor, plan.id, {
        expectedVersion: board.plan.version - 1,
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    await expect(
      requestManualRecalculation(db.pool, actor, plan.id, {
        expectedVersion: board.plan.version,
      }),
    ).rejects.toThrow("ROUTING_POINTS_REQUIRED");
    expect(
      (await manualRecalculationStatus(db.pool, plan.id)).status,
    ).toBeNull();
    const customers = await db.pool.query(
      "SELECT id,version FROM route_customers WHERE source=$1 AND odoo_partner_id=ANY($2::integer[]) ORDER BY odoo_partner_id",
      [source, [1200, 1201]],
    );
    expect(customers.rows).toHaveLength(2);
    for (const customer of customers.rows) {
      await updateCustomer(db.pool, actor, customer.id, {
        displayName: "Cliente manual",
        phone: null,
        deliveryNote: "",
        priority: "medium",
        fulfillmentMode: "delivery",
        deliveryAddress: "Bodega de ruta manual",
        mapUrl: null,
        location: { latitude: 20, longitude: -103, placeId: "manual-depot" },
        windows: [],
        expectedVersion: Number(customer.version),
      });
    }
    board = await orderBoard(db.pool, plan.id);
    const input = { expectedVersion: board.plan.version };
    expect(
      await requestManualRecalculation(db.pool, actor, plan.id, input),
    ).toEqual({ queued: true, current: false });
    const firstJob = await db.pool.query(
      "SELECT revision FROM route_recalculation_jobs WHERE plan_id=$1",
      [plan.id],
    );
    expect(
      await requestManualRecalculation(db.pool, actor, plan.id, input),
    ).toEqual({ queued: true, current: false });
    expect(
      (
        await db.pool.query(
          "SELECT revision FROM route_recalculation_jobs WHERE plan_id=$1",
          [plan.id],
        )
      ).rows[0].revision,
    ).toBe(firstJob.rows[0].revision);
    expect(await processRecalculation(db.pool, "UTC")).toBe(true);
    expect(await manualRecalculationStatus(db.pool, plan.id)).toMatchObject({
      version: board.plan.version,
      current: true,
      status: null,
    });
    expect(
      (await getPlanOptimization(db.pool, plan.id))?.routes[0].stops.map(
        (stop) => stop.shipmentId,
      ),
    ).toEqual([second.id, first.id]);
    expect(
      (await orderBoard(db.pool, plan.id)).shipments.map((item) => item.id),
    ).toEqual([second.id, first.id]);
    expect(
      await requestManualRecalculation(db.pool, actor, plan.id, input),
    ).toEqual({ queued: false, current: true });
    const published = await publishRoutes(db.pool, actor, plan.id, {
      scope: "vehicle",
      vehicleId: vehicle.id,
      expectedVersion: board.plan.version,
    });
    expect(published.changes).toHaveLength(1);
  });

  it("reuses untouched trucks and recalculates only one or both trucks after manual moves", async () => {
    const settings = await getRoutingSettings(db.pool);
    let plan = await createPlan(db.pool, actor, {
      date: "2026-09-24",
      label: "Movimiento selectivo",
    });
    plan = await saveDeparture(db.pool, actor, plan.id, {
      departureTime: "08:00",
      expectedVersion: plan.version,
    });
    const vehicles: Awaited<ReturnType<typeof createVehicle>>[] = [];
    for (const index of [1, 2])
      vehicles.push(
        await createVehicle(db.pool, actor, {
          id: randomUUID(),
          name: `Selectiva ${index}`,
          brand: "Ford",
          model: "2026",
          plate: `SEL-${randomUUID().slice(0, 8)}`,
          mileage: 0,
          fuel: "Gasolina",
          available: true,
        }),
      );
    await selectPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: vehicles.map((vehicle) => vehicle.id),
      expectedVersion: plan.version,
    });
    await persistImportPage(
      db.pool,
      actor,
      plan.id,
      page([sourceShipment(920), sourceShipment(921), sourceShipment(922)]),
    );
    const customers = await db.pool.query(
      "SELECT id,version FROM route_customers WHERE source=$1 AND odoo_partner_id=ANY($2::integer[]) ORDER BY odoo_partner_id",
      [source, [1220, 1221, 1222]],
    );
    expect(customers.rows).toHaveLength(3);
    for (const customer of customers.rows)
      await updateCustomer(db.pool, actor, customer.id, {
        displayName: "Cliente selectivo",
        phone: null,
        deliveryNote: "",
        priority: "medium",
        fulfillmentMode: "delivery",
        deliveryAddress: "Bodega",
        mapUrl: null,
        location: {
          latitude: settings.depotLocation!.latitude,
          longitude: settings.depotLocation!.longitude,
          placeId: "depot",
        },
        windows: [],
        expectedVersion: Number(customer.version),
      });
    let board = await orderBoard(db.pool, plan.id);
    const [one, two, three] = board.shipments;
    for (const [shipmentId, vehicleId] of [
      [one.id, vehicles[0].id],
      [two.id, vehicles[0].id],
      [three.id, vehicles[1].id],
    ]) {
      await moveShipment(db.pool, actor, plan.id, {
        shipmentId,
        vehicleId,
        beforeId: null,
        expectedVersion: board.plan.version,
      });
      board = await orderBoard(db.pool, plan.id);
    }
    expect(
      (await manualRecalculationStatus(db.pool, plan.id)).status,
    ).toBeNull();
    await requestManualRecalculation(db.pool, actor, plan.id, {
      expectedVersion: board.plan.version,
    });
    expect(await processRecalculation(db.pool, "UTC")).toBe(true);
    let optimization = await getPlanOptimization(db.pool, plan.id);
    expect(optimization?.current).toBe(true);
    const run = await db.pool.query(
      "SELECT id,routes,vehicle_input_hashes FROM route_optimization_runs WHERE id=$1",
      [optimization!.runId],
    );
    expect(Object.keys(run.rows[0].vehicle_input_hashes)).toHaveLength(2);
    const priorRoutes = run.rows[0].routes as Array<{
      vehicleId: string;
      encodedPolyline: string | null;
    }>;
    const untouched = priorRoutes.find(
      (route) => route.vehicleId === vehicles[1].id,
    )!;
    untouched.encodedPolyline = "unchanged-truck-proved";
    await db.pool.query(
      "UPDATE route_optimization_runs SET routes=$2::jsonb WHERE id=$1",
      [optimization!.runId, JSON.stringify(priorRoutes)],
    );
    await moveShipment(db.pool, actor, plan.id, {
      shipmentId: one.id,
      vehicleId: vehicles[0].id,
      beforeId: null,
      expectedVersion: board.plan.version,
    });
    board = await orderBoard(db.pool, plan.id);
    expect((await manualRecalculationStatus(db.pool, plan.id)).status).toBe(
      "pending",
    );
    expect(await claimRecalculation(db.pool, 8)).toBeNull();
    await requestManualRecalculation(
      db.pool,
      actor,
      plan.id,
      {
        expectedVersion: board.plan.version,
      },
      8,
    );
    expect(await processRecalculation(db.pool, "UTC", 8)).toBe(true);
    optimization = await getPlanOptimization(db.pool, plan.id);
    expect(optimization?.current).toBe(true);
    expect(
      optimization?.routes.find((route) => route.vehicleId === vehicles[1].id)
        ?.encodedPolyline,
    ).toBe("unchanged-truck-proved");
    expect(
      optimization?.routes
        .find((route) => route.vehicleId === vehicles[0].id)
        ?.stops.map((stop) => stop.shipmentId),
    ).toEqual([two.id, one.id]);
    expect(
      optimization?.routes
        .find((route) => route.vehicleId === vehicles[1].id)
        ?.stops.map((stop) => stop.shipmentId),
    ).toEqual([three.id]);
    expect(
      (
        await db.pool.query(
          "SELECT details FROM route_audit WHERE action='plan.recalculated' AND entity_id=$1 ORDER BY id DESC LIMIT 1",
          [plan.id],
        )
      ).rows[0].details,
    ).toMatchObject({
      recalculatedVehicleIds: [vehicles[0].id],
      reusedVehicleIds: [vehicles[1].id],
    });
    const latest = await db.pool.query(
      "SELECT routes FROM route_optimization_runs WHERE id=$1",
      [optimization!.runId],
    );
    const marked = latest.rows[0].routes as Array<{
      vehicleId: string;
      encodedPolyline: string | null;
    }>;
    for (const route of marked)
      route.encodedPolyline = `old-${route.vehicleId}`;
    await db.pool.query(
      "UPDATE route_optimization_runs SET routes=$2::jsonb WHERE id=$1",
      [optimization!.runId, JSON.stringify(marked)],
    );
    await moveShipment(db.pool, actor, plan.id, {
      shipmentId: two.id,
      vehicleId: vehicles[1].id,
      beforeId: three.id,
      expectedVersion: board.plan.version,
    });
    expect(await claimRecalculation(db.pool, 8)).toBeNull();
    await requestManualRecalculation(
      db.pool,
      actor,
      plan.id,
      {
        expectedVersion: (await orderBoard(db.pool, plan.id)).plan.version,
      },
      8,
    );
    expect(await processRecalculation(db.pool, "UTC", 8)).toBe(true);
    optimization = await getPlanOptimization(db.pool, plan.id);
    expect(optimization?.current).toBe(true);
    expect(optimization?.routes.map((route) => route.encodedPolyline)).toEqual([
      null,
      null,
    ]);
    expect(
      optimization?.routes
        .find((route) => route.vehicleId === vehicles[1].id)
        ?.stops.map((stop) => stop.shipmentId),
    ).toEqual([two.id, three.id]);
    expect(
      (
        await db.pool.query(
          "SELECT details FROM route_audit WHERE action='plan.recalculated' AND entity_id=$1 ORDER BY id DESC LIMIT 1",
          [plan.id],
        )
      ).rows[0].details,
    ).toMatchObject({
      recalculatedVehicleIds: vehicles.map((vehicle) => vehicle.id),
      reusedVehicleIds: [],
    });
  });
  it("preserves a manual order and replaces stale geometry without redistributing", async () => {
    await saveRoutingSettings(db.pool, actor, {
      depotAddress: "Bodega QA",
      depotLocation: { latitude: 20, longitude: -103, placeId: "warehouse" },
      expectedVersion: (await getRoutingSettings(db.pool)).version,
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
      "SELECT id,version FROM route_customers WHERE source=$1 AND odoo_partner_id=ANY($2::integer[]) ORDER BY odoo_partner_id",
      [source, [301, 302]],
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
    expect((await manualRecalculationStatus(db.pool, plan.id)).status).toBe(
      "pending",
    );
    await requestManualRecalculation(db.pool, actor, plan.id, {
      expectedVersion: (await orderBoard(db.pool, plan.id)).plan.version,
    });
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
    await requestManualRecalculation(db.pool, actor, plan.id, {
      expectedVersion: (await orderBoard(db.pool, plan.id)).plan.version,
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

  it("recalculates only the mutable lane while preserving a started lane snapshot", async () => {
    const photoRoot = await mkdtemp(join(tmpdir(), "ana-rutas-recalc-photos-"));
    try {
      let plan = await createPlan(db.pool, actor, {
        date: "2026-09-10",
        label: "Dos camionetas con una iniciada",
      });
      plan = await saveDeparture(db.pool, actor, plan.id, {
        departureTime: "08:00",
        expectedVersion: plan.version,
      });
      const drivers = [];
      const vehicles: Awaited<ReturnType<typeof createVehicle>>[] = [];
      for (const index of [1, 2]) {
        const driver = await createDriver(db.pool, actor, {
          id: randomUUID(),
          name: `Chofer recálculo ${index}`,
          phone: `331111110${index}`,
          emergency_name: "",
          emergency_phone: "",
          blood_type: "",
          active: true,
        });
        const vehicle = await createVehicle(db.pool, actor, {
          id: randomUUID(),
          name: `Camioneta recálculo ${index}`,
          brand: "Ford",
          model: "2026",
          plate: `REC-FROZEN-${index}`,
          mileage: 0,
          fuel: "Gasolina",
          available: true,
        });
        await assignDriver(db.pool, actor, vehicle.id, {
          driver_id: driver.id,
          expectedVersion: vehicle.version,
        });
        drivers.push(driver);
        vehicles.push(vehicle);
      }
      await selectPlanVehicles(db.pool, actor, plan.id, {
        vehicleIds: vehicles.map((vehicle) => vehicle.id),
        expectedVersion: plan.version,
      });
      await persistImportPage(
        db.pool,
        actor,
        plan.id,
        page([sourceShipment(500), sourceShipment(501), sourceShipment(502)]),
      );
      const customerRows = await db.pool.query(
        "SELECT id,version FROM route_customers WHERE source=$1 AND odoo_partner_id BETWEEN 800 AND 802 ORDER BY odoo_partner_id",
        [source],
      );
      expect(customerRows.rows).toHaveLength(3);
      for (const customer of customerRows.rows) {
        await updateCustomer(db.pool, actor, customer.id, {
          displayName: "Cliente de recálculo",
          phone: null,
          deliveryNote: "",
          priority: "medium",
          fulfillmentMode: "delivery",
          deliveryAddress: "Bodega QA",
          mapUrl: null,
          location: { latitude: 20, longitude: -103, placeId: "depot" },
          windows: [],
          expectedVersion: Number(customer.version),
        });
      }
      let board = await orderBoard(db.pool, plan.id);
      const [frozenOrder, firstMutable, secondMutable] = board.shipments;
      await db.pool.query(
        "UPDATE route_shipments SET vehicle_id=$2 WHERE id=$1",
        [frozenOrder.id, vehicles[0].id],
      );
      await db.pool.query(
        "UPDATE route_shipments SET vehicle_id=$2 WHERE id=ANY($1::uuid[])",
        [[firstMutable.id, secondMutable.id], vehicles[1].id],
      );
      board = await orderBoard(db.pool, plan.id);
      const frozenMetrics = {
        travelDistanceMeters: 999,
        travelDurationSeconds: 100,
        waitDurationSeconds: 0,
        totalDurationSeconds: 100,
        performedShipmentCount: 1,
      };
      const mutableMetrics = {
        travelDistanceMeters: 0,
        travelDurationSeconds: 0,
        waitDurationSeconds: 0,
        totalDurationSeconds: 0,
        performedShipmentCount: 2,
      };
      const routes = vehicles.map((vehicle, index) => {
        const own = board.shipments.filter(
          (shipment) => shipment.vehicle_id === vehicle.id,
        );
        return {
          vehicleId: vehicle.id,
          vehicleName: vehicle.name,
          encodedPolyline: null,
          segmentPolylines: [],
          departureAt: "2026-09-10T08:00:00.000Z",
          finishedAt: "2026-09-10T08:00:00.000Z",
          trafficMode: "static",
          metrics: index === 0 ? frozenMetrics : mutableMetrics,
          stops: own.map((shipment) => ({
            shipmentId: shipment.id,
            position: shipment.position,
            eta: "2026-09-10T08:00:00.000Z",
            travelDistanceMeters: 0,
            travelDurationSeconds: 0,
            waitDurationSeconds: 0,
          })),
        };
      });
      const settings = await getRoutingSettings(db.pool);
      await db.pool.query(
        `INSERT INTO route_optimization_runs
         (id,plan_id,base_plan_version,applied_plan_version,request_hash,input_fingerprint,metrics,routes,skipped,created_by)
         VALUES($1,$2,$3,$3,$4,$5,$6,$7,'[]',$8)`,
        [
          randomUUID(),
          plan.id,
          board.plan.version,
          createHash("sha256").update(`frozen-${plan.id}`).digest("hex"),
          routeFingerprint(board, settings.version),
          JSON.stringify({ ...frozenMetrics, performedShipmentCount: 3 }),
          JSON.stringify(routes),
          actor,
        ],
      );
      await publishRoutes(db.pool, actor, plan.id, {
        scope: "all",
        expectedVersion: board.plan.version,
      });
      for (let index = 0; index < 5; index++) {
        const bytes = await sharp({
          create: {
            width: 24,
            height: 24,
            channels: 3,
            background: { r: index * 30, g: 60, b: 90 },
          },
        })
          .jpeg()
          .toBuffer();
        await uploadDriverUnitPhoto(
          db.pool,
          drivers[0].id,
          plan.id,
          bytes,
          "image/jpeg",
          "UTC",
          photoRoot,
          new Date("2026-09-10T09:00:00Z"),
        );
      }
      await startDriverRoute(
        db.pool,
        drivers[0].id,
        plan.id,
        1,
        "UTC",
        new Date("2026-09-10T09:00:00Z"),
        photoRoot,
      );
      board = await orderBoard(db.pool, plan.id);
      await moveShipment(db.pool, actor, plan.id, {
        shipmentId: secondMutable.id,
        vehicleId: vehicles[1].id,
        beforeId: firstMutable.id,
        expectedVersion: board.plan.version,
      });
      await requestManualRecalculation(db.pool, actor, plan.id, {
        expectedVersion: (await orderBoard(db.pool, plan.id)).plan.version,
      });
      await db.pool.query(
        "DELETE FROM route_recalculation_jobs WHERE plan_id<>$1",
        [plan.id],
      );
      await db.pool.query(
        "UPDATE route_recalculation_jobs SET available_at=now() WHERE plan_id=$1",
        [plan.id],
      );
      expect(await processRecalculation(db.pool, "UTC")).toBe(true);
      const recalculated = await getPlanOptimization(db.pool, plan.id);
      expect(recalculated?.current).toBe(true);
      expect(
        recalculated?.routes.find((route) => route.vehicleId === vehicles[0].id)
          ?.metrics,
      ).toMatchObject(frozenMetrics);
      expect(
        recalculated?.routes
          .find((route) => route.vehicleId === vehicles[1].id)
          ?.stops.map((stop) => stop.shipmentId),
      ).toEqual([secondMutable.id, firstMutable.id]);
      expect(
        (
          await db.pool.query(
            "SELECT snapshot->'route'->'metrics' AS metrics FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2",
            [plan.id, vehicles[0].id],
          )
        ).rows[0].metrics,
      ).toMatchObject(frozenMetrics);
    } finally {
      await rm(photoRoot, { recursive: true, force: true });
    }
  });

  it("upgrades a v15 installation without deleting plans, runs or its recalculation trigger", async () => {
    const before = await db.pool.query(
      "SELECT (SELECT count(*)::integer FROM route_plans) AS plans, (SELECT count(*)::integer FROM route_optimization_runs) AS runs",
    );
    await db.pool.query(
      "ALTER TABLE route_optimization_runs DROP COLUMN vehicle_input_hashes; UPDATE rutas_installation SET schema_version=15 WHERE singleton=true",
    );
    await migrate(db.pool, db.config.instanceId);
    expect(
      (
        await db.pool.query(
          "SELECT schema_version FROM rutas_installation WHERE singleton=true",
        )
      ).rows[0].schema_version,
    ).toBe(16);
    expect(
      (
        await db.pool.query(
          "SELECT (SELECT count(*)::integer FROM route_plans) AS plans, (SELECT count(*)::integer FROM route_optimization_runs) AS runs",
        )
      ).rows[0],
    ).toEqual(before.rows[0]);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::integer AS count FROM pg_trigger WHERE tgname='route_plan_recalculation' AND NOT tgisinternal",
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::integer AS count FROM information_schema.columns WHERE table_name='route_optimization_runs' AND column_name='vehicle_input_hashes'",
        )
      ).rows[0].count,
    ).toBe(1);
  });
});
