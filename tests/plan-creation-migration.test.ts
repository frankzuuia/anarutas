import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { migrate, transaction } from "../src/core/database";
import { migratePlanCreations } from "../src/core/plan-creation-schema";
import { createPlan } from "../src/core/plans";

it("upgrades41 without changing started route data, survives rollback and concurrent repetition", async () => {
  const f = await executionFixture();
  try {
    await f.start();
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of [
        "route_plans",
        "route_shipments",
        "route_plan_vehicles",
        "route_plan_publications",
        "route_driver_executions",
        "route_unit_photos",
      ])
        result[table] = (
          await f.db.pool.query(
            `SELECT * FROM ${table} WHERE ${table === "route_plans" ? "id" : "plan_id"}=$1 ORDER BY to_jsonb(${table})::text`,
            [f.planId],
          )
        ).rows;
      return result;
    };
    const before = await snapshot();
    // Reconstruct the actual v41 constraint under another catalog name to prove
    // migration does not depend on PostgreSQL's default constraint spelling.
    await f.db.pool.query(`DROP TABLE route_plan_creation_requests;
      DROP INDEX route_plans_operation_order,route_publications_started_driver,route_publications_started_vehicle;
      ALTER TABLE route_plans ADD CONSTRAINT qa_renamed_date_unique UNIQUE(service_date);
      UPDATE rutas_installation SET schema_version=41 WHERE singleton=true`);
    await expect(
      transaction(f.db.pool, async (sql) => {
        await migratePlanCreations(sql);
        throw new Error("abort-upgrade");
      }),
    ).rejects.toThrow("abort-upgrade");
    expect(
      (await f.db.pool.query("SELECT schema_version FROM rutas_installation"))
        .rows[0].schema_version,
    ).toBe(41);
    expect(
      (
        await f.db.pool.query(
          "SELECT to_regclass('route_plan_creation_requests') AS table_name",
        )
      ).rows[0].table_name,
    ).toBeNull();
    expect(
      (
        await f.db.pool.query(
          "SELECT 1 FROM pg_constraint WHERE conname='qa_renamed_date_unique'",
        )
      ).rowCount,
    ).toBe(1);
    await Promise.all([
      migrate(f.db.pool, f.db.config.instanceId),
      migrate(f.db.pool, f.db.config.instanceId),
    ]);
    expect(
      (await f.db.pool.query("SELECT schema_version FROM rutas_installation"))
        .rows[0].schema_version,
    ).toBe(46);
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await f.db.pool.query(
          "SELECT 1 FROM pg_constraint WHERE conname='qa_renamed_date_unique'",
        )
      ).rowCount,
    ).toBe(0);
    const other = await createPlan(f.db.pool, f.actor, {
      date: (
        await f.db.pool.query(
          "SELECT service_date::text FROM route_plans WHERE id=$1",
          [f.planId],
        )
      ).rows[0].service_date,
      label: "Nuevo después del upgrade",
      commandId: randomUUID(),
    });
    expect(other.id).not.toBe(f.planId);
    await migrate(f.db.pool, f.db.config.instanceId);
    expect(await snapshot()).toEqual(before);
  } finally {
    await f.close();
  }
}, 60000);
