import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { startPostgres } from "./helpers/postgres";
import { bootstrap } from "../src/core/auth";
import { createPlan } from "../src/core/plans";
import { createVehicle } from "../src/core/fleet";
import {
  assertOrderSource,
  moveShipment,
  orderBoard,
  persistImportPage,
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
      "DROP TABLE route_shipments,route_plan_vehicles,route_order_source; UPDATE rutas_installation SET schema_version=2",
    );
    const { migrate } = await import("../src/core/database");
    await Promise.all([
      migrate(db.pool, db.config.instanceId),
      migrate(db.pool, db.config.instanceId),
    ]);
    expect(
      (await db.pool.query("SELECT schema_version FROM rutas_installation"))
        .rows[0].schema_version,
    ).toBe(3);
    const after = await Promise.all(
      ["route_users", "route_plans", "route_vehicles"].map(async (table) =>
        Number(
          (await db.pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n,
        ),
      ),
    );
    expect(after).toEqual(counts);
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
      otherPlan: 0,
      changed: 0,
    });
    let board = await orderBoard(db.pool, plan.id);
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
      otherPlan: 0,
      changed: 0,
    });
    board = await orderBoard(db.pool, plan.id);
    expect(board.shipments.find((s) => s.pickingId === 3)?.vehicle_id).toBe(
      vehicle.id,
    );
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

  it("allows only one plan to claim the same Odoo shipment under concurrent imports", async () => {
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
    expect(results.reduce((n, value) => n + value.inserted, 0)).toBe(1);
    expect(results.reduce((n, value) => n + value.otherPlan, 0)).toBe(1);
    await expect(
      assertOrderSource(
        db.pool,
        createHash("sha256").update("other-odoo").digest("hex"),
      ),
    ).rejects.toThrow("ODOO_SOURCE_CHANGED");
  });
});
