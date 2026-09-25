import type { Sql } from "./database";
import { createDriverExecution } from "./driver-execution-seed";

export async function migrateDriverExecution(sql: Sql) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS route_driver_operation_settings (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      radius_meters integer NOT NULL CHECK(radius_meters BETWEEN 25 AND 1000),
      max_accuracy_meters integer NOT NULL CHECK(max_accuracy_meters BETWEEN 1 AND radius_meters),
      max_sample_age_seconds integer NOT NULL CHECK(max_sample_age_seconds BETWEEN 5 AND 120),
      version integer NOT NULL DEFAULT 1 CHECK(version>0),
      updated_by uuid REFERENCES route_users(id), updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO route_driver_operation_settings(singleton,radius_meters,max_accuracy_meters,max_sample_age_seconds)
      VALUES(true,100,50,30) ON CONFLICT(singleton) DO NOTHING;
    ALTER TABLE route_customers ALTER COLUMN updated_by DROP NOT NULL;
    ALTER TABLE route_customers ADD COLUMN IF NOT EXISTS updated_by_driver uuid REFERENCES route_drivers(id);
    ALTER TABLE route_customers DROP CONSTRAINT IF EXISTS customer_update_actor;
    ALTER TABLE route_customers ADD CONSTRAINT customer_update_actor CHECK(num_nonnulls(updated_by,updated_by_driver)=1);
    ALTER TABLE route_customer_location_history ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES route_drivers(id);
    ALTER TABLE route_customer_location_history DROP CONSTRAINT IF EXISTS customer_location_driver_actor;
    ALTER TABLE route_customer_location_history ADD CONSTRAINT customer_location_driver_actor
      CHECK(source<>'driver' OR (driver_id IS NOT NULL AND actor_id IS NULL)) NOT VALID;
    -- Driver corrections update future customer data, never enqueue fleet/draft recalculations.
    CREATE OR REPLACE TRIGGER route_customer_recalculation AFTER UPDATE OF version ON route_customers
      FOR EACH ROW WHEN (NEW.updated_by_driver IS NULL)
      EXECUTE FUNCTION route_customer_recalculation_changed();

    -- Deliberately no plan/publication FK: retiring/deleting a draft must not erase evidence.
    CREATE TABLE IF NOT EXISTS route_driver_executions (
      id uuid PRIMARY KEY, plan_id uuid NOT NULL, vehicle_id uuid NOT NULL,
      publication_revision integer NOT NULL CHECK(publication_revision>0),
      driver_id uuid NOT NULL REFERENCES route_drivers(id),
      started_at timestamptz NOT NULL, service_date date NOT NULL,
      plan_label text NOT NULL, vehicle_name text NOT NULL, vehicle_plate text NOT NULL,
      driver_name text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
      UNIQUE(plan_id,vehicle_id,publication_revision)
    );
    CREATE TABLE IF NOT EXISTS route_driver_execution_stops (
      id uuid PRIMARY KEY, execution_id uuid NOT NULL REFERENCES route_driver_executions(id),
      position integer NOT NULL CHECK(position>0),
      customer_id uuid NOT NULL REFERENCES route_customers(id),
      shipment_ids uuid[] NOT NULL CHECK(cardinality(shipment_ids)>0),
      customer_name text NOT NULL, address text NOT NULL, order_names text[] NOT NULL,
      windows jsonb NOT NULL CHECK(jsonb_typeof(windows)='array'),
      latitude double precision CHECK(latitude BETWEEN -90 AND 90),
      longitude double precision CHECK(longitude BETWEEN -180 AND 180),
      original_latitude double precision CHECK(original_latitude BETWEEN -90 AND 90),
      original_longitude double precision CHECK(original_longitude BETWEEN -180 AND 180),
      version integer NOT NULL DEFAULT 1 CHECK(version>0), arrived_at timestamptz,
      corrected_at timestamptz, UNIQUE(execution_id,position),
      CHECK((latitude IS NULL)=(longitude IS NULL)),
      CHECK((original_latitude IS NULL)=(original_longitude IS NULL))
    );
    CREATE INDEX IF NOT EXISTS execution_stops_customer ON route_driver_execution_stops(execution_id,customer_id);
    CREATE TABLE IF NOT EXISTS route_driver_stop_events (
      id uuid PRIMARY KEY, execution_id uuid NOT NULL REFERENCES route_driver_executions(id),
      stop_id uuid NOT NULL REFERENCES route_driver_execution_stops(id),
      driver_id uuid NOT NULL REFERENCES route_drivers(id),
      device_id uuid NOT NULL REFERENCES route_driver_mobile_devices(id),
      kind text NOT NULL CHECK(kind IN ('arrival','repoint')),
      incident_kind text CHECK(incident_kind IN ('location_corrected','late_arrival')),
      occurred_at timestamptz NOT NULL, event_date date NOT NULL, timezone text NOT NULL,
      details jsonb NOT NULL CHECK(jsonb_typeof(details)='object')
    );
    CREATE UNIQUE INDEX IF NOT EXISTS execution_stop_single_arrival ON route_driver_stop_events(execution_id,stop_id)
      WHERE kind='arrival';
    CREATE INDEX IF NOT EXISTS driver_incidents_by_date ON route_driver_stop_events(event_date,occurred_at DESC,id DESC)
      WHERE incident_kind IS NOT NULL;
    CREATE INDEX IF NOT EXISTS driver_incidents_by_driver ON route_driver_stop_events(driver_id,event_date,occurred_at DESC,id DESC)
      WHERE incident_kind IS NOT NULL;
    CREATE TABLE IF NOT EXISTS route_driver_command_receipts (
      device_id uuid NOT NULL REFERENCES route_driver_mobile_devices(id),
      command_id uuid NOT NULL, request_hash text NOT NULL CHECK(length(request_hash)=64),
      execution_id uuid NOT NULL REFERENCES route_driver_executions(id),
      result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(device_id,command_id)
    );
    CREATE OR REPLACE FUNCTION preserve_driver_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'DRIVER_EVENT_IMMUTABLE' USING ERRCODE='42501';
    END $$;
    CREATE OR REPLACE TRIGGER immutable_driver_event BEFORE UPDATE OR DELETE ON route_driver_stop_events
      FOR EACH ROW EXECUTE FUNCTION preserve_driver_event();
    CREATE OR REPLACE TRIGGER immutable_driver_receipt BEFORE UPDATE OR DELETE ON route_driver_command_receipts
      FOR EACH ROW EXECUTE FUNCTION preserve_driver_event();
    CREATE OR REPLACE TRIGGER panel_changed AFTER INSERT OR UPDATE OR DELETE ON route_driver_executions
      FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
    CREATE OR REPLACE TRIGGER panel_changed AFTER INSERT ON route_driver_stop_events
      FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
    CREATE OR REPLACE TRIGGER panel_changed AFTER UPDATE ON route_driver_operation_settings
      FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
  `);
  const { rows } = await sql.query(
    "SELECT plan_id,vehicle_id FROM route_plan_publications WHERE started_at IS NOT NULL AND revoked_at IS NULL ORDER BY plan_id,vehicle_id",
  );
  for (const pub of rows) await createDriverExecution(sql, pub.plan_id, pub.vehicle_id);
  await sql.query("UPDATE rutas_installation SET schema_version=20 WHERE singleton=true");
}
