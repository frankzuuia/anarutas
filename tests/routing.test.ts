import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "../src/core/auth";
import { updateCustomer } from "../src/core/customers";
import { createVehicle } from "../src/core/fleet";
import {
  addPlanVehicles,
  moveShipment,
  orderBoard,
  persistImportPage,
  removeShipment,
  selectPlanVehicles,
} from "../src/core/orders";
import type { ImportPage, SourceShipment } from "../src/core/orders-contract";
import { createPlan } from "../src/core/plans";
import type { GoogleOptimizationResult } from "../src/core/route-optimization-google";
import {
  acquireOptimizationLease,
  releaseOptimizationLease,
} from "../src/core/route-optimization-lease";
import {
  applyOptimizationResult,
  getPlanOptimization,
} from "../src/core/route-optimization";
import {
  getRoutingSettings,
  saveRoutingSettings,
} from "../src/core/routing-settings";
import { startPostgres } from "./helpers/postgres";
import { calculateManualRoutes } from "../src/core/route-road";
import { saveDeparture } from "../src/core/departure";

let db: Awaited<ReturnType<typeof startPostgres>>;
let actor: string;
const source = createHash("sha256").update("routing-qa-odoo").digest("hex");

function sourceShipment(index: number): SourceShipment {
  return {
    pickingId: 8100 + index,
    pickingName: `WH/OUT/${8100 + index}`,
    orderId: 9100 + index,
    orderName: `S${9100 + index}`,
    partnerId: 7100 + index,
    customerName: `Cliente ruta ${index}`,
    address: `Calle prueba ${index}, Guadalajara`,
    validatedAt: "2026-09-09T12:00:00.000Z",
    promisedAt: null,
    backorderId: null,
    lines: [
      {
        moveId: 6100 + index,
        productId: 5100 + index,
        name: `Producto ${index}`,
        quantity: index,
        unit: "pieza",
      },
    ],
  };
}

function importPage(shipments: SourceShipment[]): ImportPage {
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
      name: "Routing QA",
      login: "routing-qa",
      password: randomUUID(),
    })
  ).id;
});

afterAll(async () => {
  await db?.close();
});

describe("routing settings and atomic optimization / real PostgreSQL", () => {
  it("serializes the first settings write and enforces optimistic versions", async () => {
    expect(await getRoutingSettings(db.pool)).toMatchObject({
      depotLocation: null,
      version: 0,
    });
    const input = {
      depotAddress:
        "Calle 5 1106, Colonia Industrial, Guadalajara, Jalisco, México",
      depotLocation: {
        latitude: 20.624,
        longitude: -103.354,
        placeId: "depot-place",
      },
      expectedVersion: 0,
    };
    const firstWrites = await Promise.allSettled([
      saveRoutingSettings(db.pool, actor, input),
      saveRoutingSettings(db.pool, actor, input),
    ]);
    expect(
      firstWrites.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      firstWrites.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const first = await getRoutingSettings(db.pool);
    expect(first).toMatchObject({
      version: 1,
      depotAddress: input.depotAddress,
    });
    const second = await saveRoutingSettings(db.pool, actor, {
      ...input,
      depotAddress: `${input.depotAddress}, Jalisco`,
      expectedVersion: first.version,
    });
    expect(second.version).toBe(2);
    await expect(
      saveRoutingSettings(db.pool, actor, { ...input, expectedVersion: 1 }),
    ).rejects.toThrow("VERSION_CONFLICT");
  });

  it("allows only one live Google optimization lease per plan version", async () => {
    const plan = await createPlan(db.pool, actor, {
      date: "2026-09-10",
      label: "Concurrencia Google QA",
    });
    const requestHash = createHash("sha256")
      .update("lease-request")
      .digest("hex");
    const leases = await Promise.allSettled([
      acquireOptimizationLease(db.pool, plan.id, plan.version, requestHash, 5),
      acquireOptimizationLease(db.pool, plan.id, plan.version, requestHash, 5),
    ]);
    const accepted = leases.find((result) => result.status === "fulfilled");
    expect(accepted).toBeDefined();
    if (!accepted || accepted.status !== "fulfilled")
      throw new Error("OPTIMIZATION_LEASE_NOT_ACQUIRED");
    expect(
      leases.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      leases.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await expect(
      acquireOptimizationLease(db.pool, plan.id, plan.version, requestHash, 5),
    ).rejects.toThrow("ROUTING_ALREADY_RUNNING");
    await releaseOptimizationLease(db.pool, plan.id, accepted.value);
    const retry = await acquireOptimizationLease(
      db.pool,
      plan.id,
      plan.version,
      requestHash,
      5,
    );
    expect(retry).not.toBe(accepted.value);
    await releaseOptimizationLease(db.pool, plan.id, retry);
  });

  it("applies assignment, order, metrics and private navigation tokens atomically", async () => {
    const plan = await createPlan(db.pool, actor, {
      date: "2026-09-09",
      label: "Optimización QA",
    });
    const vehicle = await createVehicle(db.pool, actor, {
      id: randomUUID(),
      name: "Ruta Google QA",
      brand: "Ford",
      model: "2026",
      plate: "RUTA-QA",
      mileage: 1,
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
      importPage([sourceShipment(1), sourceShipment(2)]),
    );
    const customerRows = await db.pool.query(
      "SELECT id,version,odoo_partner_id FROM route_customers WHERE source=$1 ORDER BY odoo_partner_id",
      [source],
    );
    for (const [index, customer] of customerRows.rows.entries())
      await updateCustomer(db.pool, actor, customer.id, {
        displayName: `Destino ${index + 1}`,
        phone: null,
        deliveryNote: "",
        priority: index === 0 ? "high" : "medium",
        fulfillmentMode: "delivery",
        deliveryAddress: `Calle prueba ${index + 1}, Guadalajara`,
        mapUrl: null,
        location: {
          latitude: 20.65 + index / 100,
          longitude: -103.35 - index / 100,
          placeId: `destination-${index + 1}`,
        },
        windows: [
          {
            days: [0, 1, 2, 3, 4, 5, 6],
            start: { hour: 9 + index, minute: 0 },
            end: { hour: 13 + index, minute: 0 },
          },
        ],
        expectedVersion: Number(customer.version),
      });

    const before = await orderBoard(db.pool, plan.id);
    const deliveries = before.shipments;
    const result: GoogleOptimizationResult = {
      routes: [
        {
          vehicleIndex: 0,
          encodedPolyline: "public-route-polyline",
          metrics: {
            travelDistanceMeters: 12500,
            travelDurationSeconds: 1800,
            waitDurationSeconds: 120,
            totalDurationSeconds: 1920,
            performedShipmentCount: 2,
          },
          visits: [
            {
              shipmentIndex: 1,
              eta: "2026-09-09T16:00:00.000Z",
              travelDistanceMeters: 7000,
              travelDurationSeconds: 1000,
              waitDurationSeconds: 120,
            },
            {
              shipmentIndex: 0,
              eta: "2026-09-09T17:00:00.000Z",
              travelDistanceMeters: 5500,
              travelDurationSeconds: 800,
              waitDurationSeconds: 0,
            },
          ],
          transitions: [
            { encodedPolyline: "leg-1", routeToken: "private-android-token" },
            { encodedPolyline: "leg-2", routeToken: null },
          ],
        },
      ],
      skipped: [],
      metrics: {
        travelDistanceMeters: 12500,
        travelDurationSeconds: 1800,
        waitDurationSeconds: 120,
        totalDurationSeconds: 1920,
        performedShipmentCount: 2,
      },
    };
    const applied = await applyOptimizationResult(
      db.pool,
      actor,
      plan.id,
      before.plan.version,
      (await getRoutingSettings(db.pool)).version,
      before,
      deliveries,
      createHash("sha256").update("routing-request").digest("hex"),
      result,
    );
    expect(applied).toMatchObject({
      current: true,
      appliedPlanVersion: before.plan.version + 1,
      metrics: { travelDistanceMeters: 12500, performedShipmentCount: 2 },
    });
    expect(JSON.stringify(applied)).not.toContain("private-android-token");
    const after = await orderBoard(db.pool, plan.id);
    expect(after.shipments.map((shipment) => shipment.id)).toEqual([
      deliveries[1].id,
      deliveries[0].id,
    ]);
    expect(
      after.shipments.every((shipment) => shipment.vehicle_id === vehicle.id),
    ).toBe(true);
    expect(
      (
        await db.pool.query(
          "SELECT routes::text FROM route_optimization_runs WHERE plan_id=$1",
          [plan.id],
        )
      ).rows[0].routes,
    ).toContain("private-android-token");
    expect(
      Number(
        (
          await db.pool.query(
            "SELECT count(*) AS count FROM route_optimization_stops WHERE run_id=$1",
            [applied!.runId],
          )
        ).rows[0].count,
      ),
    ).toBe(2);

    const extraVehicle = await createVehicle(db.pool, actor, {
      id: randomUUID(),
      name: "Ruta adicional QA",
      brand: "Ford",
      model: "2027",
      plate: "RUTA-2-QA",
      mileage: 2,
      fuel: "Gasolina",
      available: true,
    });
    await addPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: [extraVehicle.id],
      expectedVersion: after.plan.version,
    });
    const withExtraVehicle = await orderBoard(db.pool, plan.id);
    const queuedOnce = await db.pool.query(
      "SELECT revision,status FROM route_recalculation_jobs WHERE plan_id=$1",
      [plan.id],
    );
    expect(queuedOnce.rows[0]).toMatchObject({
      revision: "1",
      status: "pending",
    });
    await moveShipment(db.pool, actor, plan.id, {
      shipmentId: after.shipments[0].id,
      vehicleId: extraVehicle.id,
      beforeId: null,
      expectedVersion: withExtraVehicle.plan.version,
    });
    const redistributed = await orderBoard(db.pool, plan.id);
    expect(
      redistributed.shipments.find((s) => s.id === after.shipments[0].id)
        ?.vehicle_id,
    ).toBe(extraVehicle.id);
    expect(
      redistributed.shipments.find((s) => s.id === after.shipments[1].id)
        ?.vehicle_id,
    ).toBe(vehicle.id);
    const queuedAgain = await db.pool.query(
      "SELECT revision,status FROM route_recalculation_jobs WHERE plan_id=$1",
      [plan.id],
    );
    expect(queuedAgain.rows[0]).toMatchObject({
      revision: "2",
      status: "pending",
    });
    expect(await getPlanOptimization(db.pool, plan.id)).toMatchObject({
      current: false,
    });
    await expect(
      applyOptimizationResult(
        db.pool,
        actor,
        plan.id,
        after.plan.version,
        (await getRoutingSettings(db.pool)).version,
        after,
        deliveries,
        createHash("sha256").update("stale-request").digest("hex"),
        result,
      ),
    ).rejects.toThrow("VERSION_CONFLICT");
    const changed = await orderBoard(db.pool, plan.id);
    await removeShipment(db.pool, actor, plan.id, {
      shipmentId: changed.shipments[0].id,
      expectedVersion: changed.plan.version,
    });
    expect(
      Number(
        (
          await db.pool.query(
            "SELECT count(*) AS count FROM route_optimization_runs WHERE plan_id=$1",
            [plan.id],
          )
        ).rows[0].count,
      ),
    ).toBe(1);
    expect(
      Number(
        (
          await db.pool.query(
            "SELECT count(*) AS count FROM route_optimization_stops WHERE run_id=$1",
            [applied!.runId],
          )
        ).rows[0].count,
      ),
    ).toBe(2);
  });

  it("atomically rejects split/partial customer groups and permits a complete retry", async () => {
    let plan = await createPlan(db.pool, actor, {
      date: "2026-09-11",
      label: "Cliente indivisible QA",
    });
    plan = await saveDeparture(db.pool, actor, plan.id, {
      departureTime: "08:00",
      expectedVersion: plan.version,
    });
    const vehicles = await Promise.all(
      [1, 2].map((index) =>
        createVehicle(db.pool, actor, {
          id: randomUUID(),
          name: `Grupo ${index}`,
          brand: "Ford",
          model: "2026",
          plate: `GROUP-QA-${index}`,
          mileage: 0,
          fuel: "Gasolina",
          available: true,
        }),
      ),
    );
    await selectPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: vehicles.map((v) => v.id),
      expectedVersion: plan.version,
    });
    const first = sourceShipment(100);
    await persistImportPage(
      db.pool,
      actor,
      plan.id,
      importPage([
        first,
        { ...sourceShipment(101), partnerId: first.partnerId },
        sourceShipment(102),
      ]),
    );
    const before = await orderBoard(db.pool, plan.id);
    const currentSettings = await getRoutingSettings(db.pool);
    const calculationSettings = {
      ...currentSettings,
      depotLocation: { latitude: 20, longitude: -103, placeId: "warehouse" },
    };
    // Exercise the real zero-distance domain calculation. No road/provider response
    // is fabricated: all destinations coincide with the departure point in this test.
    const measured = await calculateManualRoutes(
      {
        ...before,
        shipments: before.shipments.map((s) => ({
          ...s,
          vehicle_id: before.vehicles[0].id,
          latitude: 20,
          longitude: -103,
          locationStatus: "confirmed",
        })),
      },
      calculationSettings,
      "UTC",
    );
    const result: GoogleOptimizationResult = {
      metrics: measured.metrics,
      skipped: [],
      routes: measured.routes.map((route, vehicleIndex) => ({
        vehicleIndex,
        encodedPolyline: null,
        metrics: route.metrics,
        transitions: route.transitions,
        departureAt: route.departureAt,
        finishedAt: route.finishedAt,
        visits: route.stops.map((stop) => ({
          shipmentIndex: before.shipments.findIndex(
            (s) => s.id === stop.shipmentId,
          ),
          eta: stop.eta,
          travelDistanceMeters: stop.travelDistanceMeters,
          travelDurationSeconds: stop.travelDurationSeconds,
          waitDurationSeconds: stop.waitDurationSeconds,
        })),
      })),
    };
    const apply = (
      value: GoogleOptimizationResult,
      by = actor,
      version = before.plan.version,
    ) =>
      applyOptimizationResult(
        db.pool,
        by,
        plan.id,
        version,
        currentSettings.version,
        before,
        before.shipments,
        createHash("sha256").update("group-retry").digest("hex"),
        value,
      );
    const split = structuredClone(result);
    split.routes[1].visits.push(split.routes[0].visits.splice(1, 1)[0]);
    await expect(apply(split)).rejects.toThrow(
      "ROUTING_CUSTOMER_GROUP_INVALID",
    );
    const partial = structuredClone(result);
    partial.routes[0].visits.splice(1, 1);
    await expect(apply(partial)).rejects.toThrow(
      "ROUTING_CUSTOMER_GROUP_INVALID",
    );
    const interleaved = structuredClone(result);
    interleaved.routes[0].visits.reverse();
    [interleaved.routes[0].visits[0], interleaved.routes[0].visits[1]] = [
      interleaved.routes[0].visits[1],
      interleaved.routes[0].visits[0],
    ];
    await expect(apply(interleaved)).rejects.toThrow(
      "ROUTING_CUSTOMER_GROUP_INVALID",
    );
    await expect(apply(result, randomUUID())).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    expect(await orderBoard(db.pool, plan.id)).toEqual(before);
    expect(
      (
        await db.pool.query(
          "SELECT id FROM route_optimization_runs WHERE plan_id=$1",
          [plan.id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.pool.query(
          "SELECT id FROM route_audit WHERE action='plan.optimized' AND entity_id=$1",
          [plan.id],
        )
      ).rowCount,
    ).toBe(0);
    expect(await apply(result)).toMatchObject({
      current: true,
      appliedPlanVersion: before.plan.version + 1,
    });
    await expect(apply(result)).rejects.toThrow("VERSION_CONFLICT");
    const after = await orderBoard(db.pool, plan.id);
    expect(after.shipments.map((s) => s.id)).toEqual(
      before.shipments.map((s) => s.id),
    );
    expect(
      after.shipments.every((s) => s.vehicle_id === before.vehicles[0].id),
    ).toBe(true);
    expect(
      (
        await db.pool.query(
          "SELECT id FROM route_optimization_runs WHERE plan_id=$1",
          [plan.id],
        )
      ).rowCount,
    ).toBe(1);
  });
});
