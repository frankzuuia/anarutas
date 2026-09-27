import type { Sql } from "./database";

export async function migrateLiveEta(sql: Sql) {
  await sql.query(`ALTER TABLE route_live_tracking ADD COLUMN IF NOT EXISTS eta jsonb
    CHECK (eta IS NULL OR jsonb_typeof(eta)='object');
    UPDATE rutas_installation SET schema_version=25 WHERE singleton=true;`);
}
