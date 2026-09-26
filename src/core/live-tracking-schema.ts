import type { Sql } from "./database";

export async function migrateLiveTracking(sql: Sql) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS route_tracking_sessions (
      id uuid PRIMARY KEY, execution_id uuid NOT NULL REFERENCES route_driver_executions(id),
      device_id uuid NOT NULL REFERENCES route_driver_mobile_devices(id),
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,execution_id,device_id)
    );
    CREATE TABLE IF NOT EXISTS route_live_tracking (
      execution_id uuid PRIMARY KEY REFERENCES route_driver_executions(id),
      session_id uuid NOT NULL, device_id uuid NOT NULL,
      sequence bigint NOT NULL DEFAULT 0 CHECK(sequence>=0),
      target_stop_id uuid, latitude double precision, longitude double precision,
      accuracy_meters double precision, observed_at timestamptz,
      received_at timestamptz NOT NULL DEFAULT now(), stopped boolean NOT NULL DEFAULT false,
      FOREIGN KEY(session_id,execution_id,device_id) REFERENCES route_tracking_sessions(id,execution_id,device_id),
      FOREIGN KEY(execution_id,target_stop_id) REFERENCES route_driver_execution_stops(execution_id,id),
      CHECK(latitude BETWEEN -90 AND 90), CHECK(longitude BETWEEN -180 AND 180),
      CHECK(accuracy_meters>=0 AND accuracy_meters<'Infinity'::float8),
      CHECK((latitude IS NULL)=(longitude IS NULL)),
      CHECK((latitude IS NULL)=(accuracy_meters IS NULL)),
      CHECK((latitude IS NULL)=(observed_at IS NULL))
    );
    CREATE TABLE IF NOT EXISTS route_control_layouts (
      user_id uuid PRIMARY KEY REFERENCES route_users(id),
      screens jsonb NOT NULL CHECK(jsonb_typeof(screens)='array'),
      version integer NOT NULL DEFAULT 1 CHECK(version>0),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    UPDATE rutas_installation SET schema_version=24 WHERE singleton=true;
  `);
}
