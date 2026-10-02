import type { Sql } from "./database";

export async function migrateCustomerUnloading(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_customers ADD COLUMN IF NOT EXISTS unloading_minutes integer
      CHECK (unloading_minutes >= 0 AND unloading_minutes < 524160);
    UPDATE rutas_installation SET schema_version=43 WHERE singleton=true;
  `);
}
