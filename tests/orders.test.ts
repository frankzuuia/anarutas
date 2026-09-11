import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { startPostgres } from "./helpers/postgres";
import { bootstrap } from "../src/core/auth";
import { createPlan, deletePlan, listPlans } from "../src/core/plans";
import { createVehicle } from "../src/core/fleet";
import {
  addPlanVehicles,
  assertOrderSource,
  moveShipment,
  orderBoard,
  persistImportPage,
  removePlanVehicle,
  removeShipment,
  selectPlanVehicles,
} from "../src/core/orders";
import type { ImportPage, SourceShipment } from "../src/core/orders-contract";

let db: Awaited<ReturnType<typeof startPostgres>>;
let actor: string;
const source = createHash("sha256").update("qa-odoo").digest("hex");
function shipment(
  pickingId: number,
  orderId: number,
  partnerId = 11,
): SourceShipment {
  return {
    pickingId,
    pickingName: `WH/OUT/${pickingId}`,
    orderId,
    orderName: `S${orderId}`,
    partnerId,
    customerName: "Fonda Martha",
    address: "Av. Guadalupe 851, Guadalajara",
    validatedAt: "2026-09-09T03:47:40.000Z",
    promisedAt: null,
    backorderId: null,
    lines: [
      {
        moveId: pickingId * 10,
        productId: 260,
        name: "Producto real QA",
        quantity: 4,
        unit: "kg",
      },
    ],
  };
}
function page(items: SourceShipment[]): ImportPage {
  return {
    fingerprint: source,
    shipments: items,
    nextCursor: 9,
    ceiling: 9,
    hasMore: false,
    inspected: items.length,
    excluded: 0,
  };
}
beforeAll(async () => {
  db = await startPostgres();
  actor = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "Orders QA",
      login: "orders-qa",
      password: randomUUID(),
    })
  ).id;
});
afterAll(async () => {
  await db?.close();
});

describe("fulfilled orders / real PostgreSQL", () => {
  it("upgrades v2 without losing plan, account or fleet", async () => {
    const counts = await Promise.all(
      ["route_users", "route_plans", "route_vehicles"].map(async (table) =>
        Number(
          (await db.pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n,
        ),
      ),
    );
    await db.pool.query(
      "DROP TABLE route_optimization_stops,route_optimization_leases,route_optimization_runs,route_routing_settings,route_customer_location_history,route_customer_windows,route_shipments,route_customers,route_plan_vehicles,route_order_source; UPDATE rutas_installation SET schema_version=2",
    );
    const { migrate } = await import("../src/core/database");
    await Promise.all([
      migrate(db.pool, db.config.instanceId),
      migrate(db.pool, db.config.instanceId),
    ]);
    expect(
      (await db.pool.query("SELECT schema_version FROM rutas_installation"))
        .rows[0].schema_version,
    ).toBe(7);
    const identityIndex = await db.pool.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='route_shipments_plan_source_picking_order'",
    );
    expect(identityIndex.rows[0].indexdef).toContain(
      "(plan_id, source, picking_id, order_id)",
    );
    const after = await Promise.all(
      ["route_users", "route_plans", "route_vehicles"].map(async (table) =>
        Number(
          (await db.pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n,
        ),
      ),
    );
    expect(after).toEqual(counts);
  });

  it("upgrades an actual v3 shipment to plan-scoped identity without data loss", async () => {
    const plan = await createPlan(db.pool, actor, {
      date: "2026-09-09",
      label: "Migración v3 QA",
    });
    await persistImportPage(db.pool, actor, plan.id, page([shipment(1, 1)]));
    const before = (
      await db.pool.query(
        "SELECT id,plan_id,source,picking_id,order_id,snapshot FROM route_shipments WHERE plan_id=$1",
        [plan.id],
      )
    ).rows;
    await db.pool.query(`
      DROP TABLE route_optimization_stops,route_optimization_leases,route_optimization_runs,route_routing_settings;
      DROP TABLE route_customer_location_history,route_customer_windows;
      ALTER TABLE route_shipments DROP CONSTRAINT route_shipments_customer_identity;
      DROP TABLE route_customers;
      DROP INDEX route_shipments_plan_source_picking_order;
      ALTER TABLE route_shipments ADD CONSTRAINT route_shipments_source_picking_id_order_id_key UNIQUE(source,picking_id,order_id);
      UPDATE rutas_installation SET schema_version=3 WHERE singleton=true;
    `);
    const { migrate } = await import("../src/core/database");
    await migrate(db.pool, db.config.instanceId);
    expect(
      (await db.pool.query("SELECT schema_version FROM rutas_installation"))
        .rows[0].schema_version,
    ).toBe(7);
    expect(
      (
        await db.pool.query(
          "SELECT id,plan_id,source,picking_id,order_id,snapshot FROM route_shipments WHERE plan_id=$1",
          [plan.id],
        )
      ).rows,
    ).toEqual(before);
  });

  it("keeps independent orders for one customer, reloads idempotently and preserves assignment", async () => {
    const plan = await createPlan(db.pool, actor, {
      date: "2026-09-10",
      label: "Ruta QA",
    });
    const vehicle = await createVehicle(db.pool, actor, {
      id: randomUUID(),
      name: "Camioneta QA",
      brand: "Ford",
      model: "2026",
      plate: randomUUID().slice(0, 8),
      mileage: 1,
      fuel: "Gasolina",
      available: true,
    });
    await selectPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: [vehicle.id],
      expectedVersion: plan.version,
    });
    const first = await persistImportPage(
      db.pool,
      actor,
      plan.id,
      page([shipment(3, 4), shipment(4, 3)]),
    );
    expect(first).toMatchObject({
      inserted: 2,
      existing: 0,
      changed: 0,
    });
    let board = await orderBoard(db.pool, plan.id);
    expect(board.plan.version).toBe(plan.version + 2);
    expect(board.shipments.map((s) => s.orderId)).toEqual([4, 3]);
    expect(
      board.shipments.every(
        (s) => s.high_priority === null && s.window_start === null,
      ),
    ).toBe(true);
    await moveShipment(db.pool, actor, plan.id, {
      shipmentId: board.shipments[0].id,
      vehicleId: vehicle.id,
      beforeId: null,
      expectedVersion: board.plan.version,
    });
    const reload = await persistImportPage(
      db.pool,
      actor,
      plan.id,
      page([shipment(3, 4), shipment(4, 3)]),
    );
    expect(reload).toMatchObject({
      inserted: 0,
      existing: 2,
      changed: 0,
    });
    board = await orderBoard(db.pool, plan.id);
    expect(board.plan.version).toBe(plan.version + 3);
    expect(board.shipments.find((s) => s.pickingId === 3)?.vehicle_id).toBe(
      vehicle.id,
    );
    const changedShipment = shipment(3, 4);
    changedShipment.customerName = "Cambio posterior en Odoo";
    const changed = await persistImportPage(
      db.pool,
      actor,
      plan.id,
      page([changedShipment]),
    );
    expect(changed).toMatchObject({ inserted: 0, existing: 0, changed: 1 });
    expect((await orderBoard(db.pool, plan.id)).plan.version).toBe(
      board.plan.version,
    );
    expect(
      (await orderBoard(db.pool, plan.id)).shipments.find(
        (item) => item.pickingId === 3,
      )?.customerName,
    ).toBe("Fonda Martha");
    expect(
      (
        await db.pool.query(
          "SELECT action,details FROM route_audit WHERE action='orders.imported' AND entity_id=$1 ORDER BY id DESC LIMIT 1",
          [plan.id],
        )
      ).rows[0],
    ).toEqual({
      action: "orders.imported",
      details: {
        inserted: 0,
        existing: 0,
        changed: 1,
        inspected: 1,
        excluded: 0,
      },
    });
    await selectPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: [],
      expectedVersion: board.plan.version,
    });
    expect(
      (await orderBoard(db.pool, plan.id)).shipments.every(
        (s) => s.vehicle_id === null,
      ),
    ).toBe(true);
  });

  it("adds and removes plan vehicles without losing orders", async () => {
    const plan = await createPlan(db.pool, actor, {
      date: "2026-09-13",
      label: "Adición de flota QA",
    });
    const vehicles = await Promise.all(
      ["Base", "Nueva", "Concurrente A", "Concurrente B"].map((name) =>
        createVehicle(db.pool, actor, {
          id: randomUUID(),
          name: `Camioneta ${name}`,
          brand: "Ford",
          model: "2026",
          plate: randomUUID().slice(0, 8),
          mileage: 1,
          fuel: "Gasolina",
          available: true,
        }),
      ),
    );
    await selectPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: [vehicles[0].id],
      expectedVersion: plan.version,
    });
    await persistImportPage(db.pool, actor, plan.id, page([shipment(13, 13)]));
    let board = await orderBoard(db.pool, plan.id);
    const order = board.shipments[0];
    await moveShipment(db.pool, actor, plan.id, {
      shipmentId: order.id,
      vehicleId: vehicles[0].id,
      beforeId: null,
      expectedVersion: board.plan.version,
    });
    board = await orderBoard(db.pool, plan.id);
    await addPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: [vehicles[1].id],
      expectedVersion: board.plan.version,
    });
    board = await orderBoard(db.pool, plan.id);
    expect(board.vehicles.map((vehicle) => vehicle.id).sort()).toEqual(
      [vehicles[0].id, vehicles[1].id].sort(),
    );
    expect(board.shipments[0].vehicle_id).toBe(vehicles[0].id);
    expect(
      (
        await db.pool.query(
          "SELECT details FROM route_audit WHERE action='plan.vehicles.added' AND entity_id=$1 ORDER BY id DESC LIMIT 1",
          [plan.id],
        )
      ).rows[0].details,
    ).toEqual({ count: 1 });

    const unchangedVersion = board.plan.version;
    await addPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: [vehicles[1].id],
      expectedVersion: unchangedVersion,
    });
    expect((await orderBoard(db.pool, plan.id)).plan.version).toBe(
      unchangedVersion,
    );

    const additions = await Promise.allSettled(
      vehicles.slice(2).map((vehicle) =>
        addPlanVehicles(db.pool, actor, plan.id, {
          vehicleIds: [vehicle.id],
          expectedVersion: unchangedVersion,
        }),
      ),
    );
    expect(
      additions.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      additions.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      (
        additions.find(
          (result) => result.status === "rejected",
        ) as PromiseRejectedResult
      ).reason,
    ).toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    board = await orderBoard(db.pool, plan.id);
    expect(board.vehicles).toHaveLength(3);
    expect(board.shipments[0].vehicle_id).toBe(vehicles[0].id);

    const unavailable = await createVehicle(db.pool, actor, {
      id: randomUUID(),
      name: "Camioneta no disponible",
      brand: "Ford",
      model: "2026",
      plate: randomUUID().slice(0, 8),
      mileage: 1,
      fuel: "Gasolina",
      available: false,
    });
    await expect(
      addPlanVehicles(db.pool, actor, plan.id, {
        vehicleIds: [unavailable.id],
        expectedVersion: board.plan.version,
      }),
    ).rejects.toThrow("FLEET_UNAVAILABLE");
    await expect(
      addPlanVehicles(db.pool, actor, plan.id, {
        vehicleIds: [],
        expectedVersion: board.plan.version,
      }),
    ).rejects.toThrow("SELECT_VEHICLES");
    expect((await orderBoard(db.pool, plan.id)).vehicles).toHaveLength(3);

    await removePlanVehicle(db.pool, actor, plan.id, {
      vehicleId: vehicles[0].id,
      expectedVersion: board.plan.version,
    });
    board = await orderBoard(db.pool, plan.id);
    expect(board.vehicles).toHaveLength(2);
    expect(board.shipments[0].vehicle_id).toBeNull();
    expect(
      (
        await db.pool.query(
          "SELECT details FROM route_audit WHERE action='plan.vehicle.removed' AND entity_id=$1 ORDER BY id DESC LIMIT 1",
          [plan.id],
        )
      ).rows[0].details,
    ).toEqual({ vehicleId: vehicles[0].id, unassigned: 1 });
    await expect(
      removePlanVehicle(db.pool, actor, plan.id, {
        vehicleId: vehicles[0].id,
        expectedVersion: board.plan.version,
      }),
    ).rejects.toThrow("PLAN_VEHICLE_NOT_FOUND");

    const removals = await Promise.allSettled(
      board.vehicles.map((vehicle) =>
        removePlanVehicle(db.pool, actor, plan.id, {
          vehicleId: vehicle.id,
          expectedVersion: board.plan.version,
        }),
      ),
    );
    expect(
      removals.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      (
        removals.find(
          (result) => result.status === "rejected",
        ) as PromiseRejectedResult
      ).reason,
    ).toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    expect((await orderBoard(db.pool, plan.id)).vehicles).toHaveLength(1);
  });

  it("keeps the same Odoo shipment independent in concurrent plans", async () => {
    const a = await createPlan(db.pool, actor, {
      date: "2026-09-11",
      label: "A",
    });
    const b = await createPlan(db.pool, actor, {
      date: "2026-09-12",
      label: "B",
    });
    const results = await Promise.all([
      persistImportPage(db.pool, actor, a.id, page([shipment(7, 7, 13)])),
      persistImportPage(db.pool, actor, b.id, page([shipment(7, 7, 13)])),
    ]);
    expect(results.map((value) => value.inserted)).toEqual([1, 1]);
    expect((await orderBoard(db.pool, a.id)).shipments).toHaveLength(1);
    const boardB = await orderBoard(db.pool, b.id);
    expect(boardB.shipments).toHaveLength(1);
    await removeShipment(db.pool, actor, a.id, {
      shipmentId: (await orderBoard(db.pool, a.id)).shipments[0].id,
      expectedVersion: (await orderBoard(db.pool, a.id)).plan.version,
    });
    expect((await orderBoard(db.pool, a.id)).shipments).toHaveLength(0);
    expect((await orderBoard(db.pool, b.id)).shipments).toHaveLength(1);
    expect(
      (
        await persistImportPage(
          db.pool,
          actor,
          b.id,
          page([shipment(7, 7, 13)]),
        )
      ).existing,
    ).toBe(1);
    await expect(
      assertOrderSource(
        db.pool,
        createHash("sha256").update("other-odoo").digest("hex"),
      ),
    ).rejects.toThrow("ODOO_SOURCE_CHANGED");
    await expect(
      persistImportPage(db.pool, actor, b.id, {
        ...page([shipment(8, 8)]),
        fingerprint: createHash("sha256").update("other-odoo").digest("hex"),
      }),
    ).rejects.toMatchObject({ code: "ODOO_SOURCE_CHANGED", status: 409 });
    expect((await orderBoard(db.pool, b.id)).shipments).toHaveLength(1);
  });

  it("deletes one versioned plan with local dependencies and preserves master data", async () => {
    const plan = await createPlan(db.pool, actor, {
      date: "2026-09-15",
      label: "Plan descartable QA",
    });
    const vehicle = await createVehicle(db.pool, actor, {
      id: randomUUID(),
      name: "Unidad preservada QA",
      brand: "Ford",
      model: "2026",
      plate: randomUUID().slice(0, 8),
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
      page([shipment(71, 71), shipment(72, 72)]),
    );
    let board = await orderBoard(db.pool, plan.id);
    await expect(
      deletePlan(db.pool, actor, plan.id, {
        expectedVersion: board.plan.version - 1,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    expect((await orderBoard(db.pool, plan.id)).shipments).toHaveLength(2);

    board = await orderBoard(db.pool, plan.id);
    await expect(
      deletePlan(db.pool, actor, plan.id, {
        expectedVersion: String(board.plan.version),
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    const deleted = await deletePlan(db.pool, actor, plan.id, {
      expectedVersion: board.plan.version,
    });
    expect(deleted).toMatchObject({
      id: plan.id,
      label: "Plan descartable QA",
      shipments: 2,
      vehicles: 1,
    });
    expect((await listPlans(db.pool)).some((item) => item.id === plan.id)).toBe(
      false,
    );
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::integer AS count FROM route_vehicles WHERE id=$1",
          [vehicle.id],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await db.pool.query(
          "SELECT details FROM route_audit WHERE action='plan.deleted' AND entity_id=$1 ORDER BY id DESC LIMIT 1",
          [plan.id],
        )
      ).rows[0].details,
    ).toMatchObject({ shipments: 2, vehicles: 1 });
    await expect(orderBoard(db.pool, plan.id)).rejects.toThrow("NOT_FOUND");
    await expect(
      deletePlan(db.pool, actor, plan.id, {
        expectedVersion: board.plan.version,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("removes a shipment atomically and allows a later Odoo reload to recover it", async () => {
    const plan = await createPlan(db.pool, actor, {
      date: "2026-09-14",
      label: "Retiro recuperable QA",
    });
    const vehicle = await createVehicle(db.pool, actor, {
      id: randomUUID(),
      name: "Camioneta retiro QA",
      brand: "Ford",
      model: "2026",
      plate: randomUUID().slice(0, 8),
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
      page([shipment(61, 61), shipment(62, 62), shipment(63, 63)]),
    );
    let board = await orderBoard(db.pool, plan.id);
    const removed = board.shipments[1];
    await moveShipment(db.pool, actor, plan.id, {
      shipmentId: removed.id,
      vehicleId: vehicle.id,
      beforeId: null,
      expectedVersion: board.plan.version,
    });
    await persistImportPage(db.pool, actor, plan.id, page([shipment(64, 64)]));
    board = await orderBoard(db.pool, plan.id);
    await removeShipment(db.pool, actor, plan.id, {
      shipmentId: removed.id,
      expectedVersion: board.plan.version,
    });
    board = await orderBoard(db.pool, plan.id);
    expect(board.shipments.map((item) => item.pickingId)).toEqual([61, 63, 64]);
    expect(board.shipments.map((item) => item.position)).toEqual([1, 2, 3]);
    expect(
      (
        await db.pool.query(
          "SELECT details FROM route_audit WHERE action='shipment.removed' AND entity_id=$1",
          [removed.id],
        )
      ).rows[0].details,
    ).toEqual({
      orderId: 62,
      pickingId: 62,
      planId: plan.id,
      vehicleId: vehicle.id,
    });
    await expect(
      removeShipment(db.pool, actor, plan.id, {
        shipmentId: removed.id,
        expectedVersion: board.plan.version,
      }),
    ).rejects.toThrow("NOT_FOUND");
    const reload = await persistImportPage(
      db.pool,
      actor,
      plan.id,
      page([shipment(62, 62)]),
    );
    expect(reload).toMatchObject({ inserted: 1, existing: 0 });
    board = await orderBoard(db.pool, plan.id);
    expect(board.shipments.map((item) => item.pickingId)).toEqual([
      61, 63, 64, 62,
    ]);
    const concurrent = await Promise.allSettled(
      board.shipments.slice(0, 2).map((item) =>
        removeShipment(db.pool, actor, plan.id, {
          shipmentId: item.id,
          expectedVersion: board.plan.version,
        }),
      ),
    );
    expect(
      concurrent.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      concurrent.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      (
        concurrent.find(
          (result) => result.status === "rejected",
        ) as PromiseRejectedResult
      ).reason,
    ).toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    expect((await orderBoard(db.pool, plan.id)).shipments).toHaveLength(3);
  });
});
