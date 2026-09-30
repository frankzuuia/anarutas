import type { Sql } from "./database";

export async function migrateLiveWarehouse(sql: Sql) {
  await sql.query(`ALTER TABLE route_live_tracking ADD COLUMN IF NOT EXISTS warehouse_depot_version integer
    CHECK(warehouse_depot_version IS NULL OR (warehouse_depot_version>0 AND target_stop_id IS NULL));
    UPDATE rutas_installation SET schema_version=33 WHERE singleton=true;`);
}
