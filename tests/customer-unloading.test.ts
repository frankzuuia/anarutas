import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicationValidationFixture } from "./helpers/publication-validation";
import {
  getCustomer,
  listCustomers,
  updateCustomer,
} from "../src/core/customers";
import type { Customer } from "../src/core/customers-contract";
import { orderBoard } from "../src/core/orders";
import { migrate } from "../src/core/database";
import {
  readPlanOptimization,
  applyOptimizationResult,
} from "../src/core/route-optimization";
import { buildDirectFleetRequest } from "../src/core/route-google-direct";
import { zoneSettings } from "./helpers/zone-board";
import { saveRoutingSettings } from "../src/core/routing-settings";
import { planRouteDeterministically } from "../src/core/route-deterministic-planner";

let f: Awaited<ReturnType<typeof publicationValidationFixture>>;
const input = (c: Customer) => ({
  displayName: c.displayName,
  phone: c.phone,
  deliveryNote: c.deliveryNote,
  priority: c.priority,
  fulfillmentMode: c.fulfillmentMode,
  deliveryAddress: c.deliveryAddress,
  mapUrl: c.mapUrl,
  location: {
    latitude: c.latitude,
    longitude: c.longitude,
    placeId: c.placeId,
  },
  windows: c.windows.map((w) => ({
    start: { hour: Math.floor(w.startMinute / 60), minute: w.startMinute % 60 },
    end: { hour: Math.floor(w.endMinute / 60), minute: w.endMinute % 60 },
  })),
  expectedVersion: c.version,
});
beforeAll(async () => {
  f = await publicationValidationFixture();
  await f.db.pool.query(
    "UPDATE route_plans SET departure_minute=480 WHERE id=$1",
    [f.planId],
  );
});
afterAll(async () => f?.close());
describe("customer service duration on real PostgreSQL", () => {
  it("uses the real fallback with zone ownership and service time at a co-located depot", async () => {
    expect(process.env.RUTAS_GOOGLE_CLOUD_PROJECT_ID || "").toBe("");
    const current = (
      await listCustomers(f.db.pool, { archived: false, limit: 10 })
    ).customers[0];
    await updateCustomer(f.db.pool, f.actor, current.id, {
      ...input(current),
      unloadingMinutes: 12,
    });
    await saveRoutingSettings(f.db.pool, f.actor, {
      depotAddress: "Bodega QA",
      depotLocation: {
        latitude: current.latitude,
        longitude: current.longitude,
        placeId: null,
      },
      expectedVersion: 0,
    });
    const board = await orderBoard(f.db.pool, f.planId);
    const result = await planRouteDeterministically(
      f.db.pool,
      f.actor,
      f.planId,
      { expectedVersion: board.plan.version },
      f.timezone,
    );
    expect(result!.metrics.performedShipmentCount).toBe(board.shipments.length);
    expect(result!.metrics.totalDurationSeconds).toBe(720);
    expect(result!.routes.filter((r) => r.stops.length)).toHaveLength(1);
    expect(result!.metrics.travelDistanceMeters).toBe(0);
    expect(
      (await orderBoard(f.db.pool, f.planId)).shipments.every(
        (s) =>
          s.vehicle_id ===
          result!.routes.find((r) => r.stops.length)!.vehicleId,
      ),
    ).toBe(true);
    // Restore only isolated QA configuration for the remaining migration tests.
    await f.db.pool.query("DELETE FROM route_routing_settings");
  });
  it("migrates version42 concurrently and repeatedly without changing existing data", async () => {
    const before = (
      await f.db.pool.query(
        "SELECT id,display_name,version FROM route_customers ORDER BY id",
      )
    ).rows;
    await f.db.pool.query(
      "DROP VIEW route_customer_unloading; ALTER TABLE route_customers DROP COLUMN unloading_minutes; UPDATE rutas_installation SET schema_version=42",
    );
    await Promise.all([
      migrate(f.db.pool, f.db.config.instanceId),
      migrate(f.db.pool, f.db.config.instanceId),
    ]);
    expect(
      (await f.db.pool.query("SELECT schema_version FROM rutas_installation"))
        .rows[0].schema_version,
    ).toBe(45);
    expect(
      (
        await f.db.pool.query(
          "SELECT id,display_name,version FROM route_customers ORDER BY id",
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await f.db.pool.query(
          "SELECT DISTINCT unloading_minutes FROM route_customers",
        )
      ).rows,
    ).toEqual([{ unloading_minutes: null }]);
    await expect(
      f.db.pool.query("UPDATE route_customers SET unloading_minutes=-1"),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      f.db.pool.query("UPDATE route_customers SET unloading_minutes=524160"),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("persists service time, protects stale/unauthorized writes and invalidates the calculated plan", async () => {
    const customer = (
      await listCustomers(f.db.pool, { archived: false, limit: 10 })
    ).customers[0];
    await f.storeCalculation();
    expect((await readPlanOptimization(f.db.pool, f.planId))!.current).toBe(
      true,
    );
    const updated = await updateCustomer(f.db.pool, f.actor, customer.id, {
      ...input(customer),
      unloadingMinutes: 17,
    });
    expect(updated.unloadingMinutes).toBe(17);
    expect((await readPlanOptimization(f.db.pool, f.planId))!.current).toBe(
      false,
    );
    const board = await orderBoard(f.db.pool, f.planId);
    expect(
      board.shipments
        .filter((s) => s.partnerId === customer.odooPartnerId)
        .every((s) => s.unloadingMinutes === 17),
    ).toBe(true);
    const { request } = buildDirectFleetRequest(
      board,
      zoneSettings,
      f.timezone,
    );
    expect(
      request.model.shipments.some((s) => s.deliveries[0].duration === "1020s"),
    ).toBe(true);
    await expect(
      updateCustomer(f.db.pool, f.actor, customer.id, {
        ...input(customer),
        unloadingMinutes: 9,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      updateCustomer(
        f.db.pool,
        "00000000-0000-0000-0000-000000000000",
        customer.id,
        { ...input(updated), unloadingMinutes: 9 },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const audit = (
      await f.db.pool.query(
        "SELECT details FROM route_audit WHERE entity_id=$1 AND action='customer.updated' ORDER BY created_at DESC LIMIT 1",
        [customer.id],
      )
    ).rows[0].details;
    expect(audit.unloadingMinutes).toBe(17);
    expect(
      (
        await f.db.pool.query(
          "SELECT status FROM route_recalculation_jobs WHERE plan_id=$1",
          [f.planId],
        )
      ).rows[0].status,
    ).toBe("pending");
    // Older HTTP clients omit the new field; they must never silently erase it.
    const legacy = await updateCustomer(
      f.db.pool,
      f.actor,
      customer.id,
      input(updated),
    );
    expect(legacy.unloadingMinutes).toBe(17);
    await saveRoutingSettings(f.db.pool, f.actor, {
      depotAddress: zoneSettings.depotAddress,
      depotLocation: zoneSettings.depotLocation,
      expectedVersion: 0,
    });
    const staleBoard = await orderBoard(f.db.pool, f.planId);
    await updateCustomer(f.db.pool, f.actor, customer.id, {
      ...input(legacy),
      unloadingMinutes: 18,
    });
    await expect(
      applyOptimizationResult(
        f.db.pool,
        f.actor,
        f.planId,
        staleBoard.plan.version,
        1,
        staleBoard,
        staleBoard.shipments,
        "concurrent",
        {
          routes: [],
          skipped: [],
          metrics: {
            performedShipmentCount: 0,
            totalDurationSeconds: 0,
            waitDurationSeconds: 0,
            travelDistanceMeters: 0,
            travelDurationSeconds: 0,
          },
        },
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const current = await getCustomer(f.db.pool, customer.id);
    const cleared = await updateCustomer(f.db.pool, f.actor, customer.id, {
      ...input(current),
      unloadingMinutes: null,
    });
    expect(cleared.unloadingMinutes).toBeNull();
    for (const value of [-1, 1.2, "9", 524160])
      await expect(
        updateCustomer(f.db.pool, f.actor, customer.id, {
          ...input(cleared),
          unloadingMinutes: value,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
