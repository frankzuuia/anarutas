import type { Sql } from "./database";

export async function migrateUnloadingLearning(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_customers ADD COLUMN IF NOT EXISTS unloading_automatic boolean NOT NULL DEFAULT true;
    CREATE TABLE IF NOT EXISTS route_unloading_observations (
      payment_id uuid PRIMARY KEY REFERENCES route_order_payments(id),
      arrival_event_id uuid NOT NULL REFERENCES route_driver_stop_events(id),
      captured_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS unloading_observation_visit ON route_unloading_observations(arrival_event_id);
    CREATE TABLE IF NOT EXISTS route_unloading_visits (
      arrival_event_id uuid PRIMARY KEY REFERENCES route_driver_stop_events(id),
      customer_id uuid NOT NULL REFERENCES route_customers(id),
      location_version integer NOT NULL CHECK(location_version>=0),
      arrived_at timestamptz NOT NULL, completed_at timestamptz NOT NULL,
      CHECK(completed_at>arrived_at AND completed_at-arrived_at<=interval '524159 minutes')
    );
    CREATE INDEX IF NOT EXISTS unloading_customer_recent
      ON route_unloading_visits(customer_id,location_version,completed_at DESC,arrival_event_id DESC);
    CREATE OR REPLACE TRIGGER immutable_unloading_observation BEFORE UPDATE OR DELETE ON route_unloading_observations
      FOR EACH ROW EXECUTE FUNCTION preserve_driver_event();
    CREATE OR REPLACE TRIGGER immutable_unloading_visit BEFORE UPDATE OR DELETE ON route_unloading_visits
      FOR EACH ROW EXECUTE FUNCTION preserve_driver_event();
    CREATE OR REPLACE TRIGGER panel_changed AFTER INSERT ON route_unloading_visits
      FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
    CREATE OR REPLACE VIEW route_customer_unloading AS
      SELECT c.id, recent.sample_count, recent.last_observed_at,
        CASE WHEN recent.sample_count>=2 THEN recent.median_minutes END AS learned_minutes,
        CASE WHEN c.unloading_automatic AND recent.sample_count>=2 THEN recent.median_minutes
          ELSE c.unloading_minutes END AS effective_minutes
      FROM route_customers c CROSS JOIN LATERAL (
        SELECT count(*)::integer AS sample_count, max(v.completed_at) AS last_observed_at,
          ceil(percentile_cont(0.5) WITHIN GROUP
            (ORDER BY extract(epoch FROM v.completed_at-v.arrived_at)/60))::integer AS median_minutes
        FROM (SELECT arrived_at,completed_at FROM route_unloading_visits
          WHERE customer_id=c.id AND location_version=c.location_version
          ORDER BY completed_at DESC,arrival_event_id DESC LIMIT 3) v
      ) recent;
    UPDATE rutas_installation SET schema_version=45 WHERE singleton=true;
  `);
}
