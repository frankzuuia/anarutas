import type { Sql } from "./database";

export async function migrateManualPublication(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_optimization_runs
      ADD COLUMN IF NOT EXISTS vehicle_input_hashes jsonb;
    UPDATE rutas_installation SET schema_version=16 WHERE singleton=true;
  `);
}
