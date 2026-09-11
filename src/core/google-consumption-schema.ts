import type { Sql } from "./database";

export async function migrateGoogleConsumption(sql: Sql) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS route_google_consumption_state (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      status text NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','running','ready','failed')),
      token uuid,
      lease_until timestamptz,
      last_attempt_at timestamptz,
      last_success_at timestamptz,
      next_sync_at timestamptz NOT NULL DEFAULT now(),
      error_code text,
      provider_export_time timestamptz,
      snapshot jsonb,
      updated_by uuid REFERENCES route_users(id),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK((status='running') = (token IS NOT NULL AND lease_until IS NOT NULL)),
      CHECK(snapshot IS NULL OR jsonb_typeof(snapshot)='object')
    );
    INSERT INTO route_google_consumption_state(singleton) VALUES(true)
    ON CONFLICT(singleton) DO NOTHING;
    UPDATE rutas_installation SET schema_version=8 WHERE singleton=true;
  `);
}
