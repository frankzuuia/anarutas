import type { Sql } from "./database";

export async function migrateDriverRouteCompletion(sql: Sql) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS route_driver_execution_completions (
      execution_id uuid PRIMARY KEY REFERENCES route_driver_executions(id),
      driver_id uuid NOT NULL REFERENCES route_drivers(id),
      device_id uuid NOT NULL REFERENCES route_driver_mobile_devices(id),
      command_id uuid NOT NULL, completed_at timestamptz NOT NULL,
      depot_version integer NOT NULL CHECK(depot_version>0),
      details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),
      UNIQUE(device_id,command_id)
    );
    CREATE OR REPLACE TRIGGER immutable_driver_completion
      BEFORE UPDATE OR DELETE ON route_driver_execution_completions
      FOR EACH ROW EXECUTE FUNCTION preserve_driver_event();
    UPDATE rutas_installation SET schema_version=32 WHERE singleton=true;
  `);
}
