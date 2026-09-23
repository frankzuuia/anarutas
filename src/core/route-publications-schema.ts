import type { Sql } from "./database";

export async function migrateRoutePublications(sql: Sql) {
  await sql.query(`
    CREATE TABLE route_plan_publications (
      plan_id uuid NOT NULL,
      vehicle_id uuid NOT NULL,
      driver_id uuid NOT NULL REFERENCES route_drivers(id),
      revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
      source_plan_version integer NOT NULL CHECK(source_plan_version > 0),
      snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot) = 'object'),
      snapshot_hash text NOT NULL CHECK(char_length(snapshot_hash) = 64),
      published_by uuid NOT NULL REFERENCES route_users(id),
      published_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      started_driver_id uuid REFERENCES route_drivers(id),
      PRIMARY KEY(plan_id,vehicle_id),
      FOREIGN KEY(plan_id,vehicle_id)
        REFERENCES route_plan_vehicles(plan_id,vehicle_id) ON DELETE CASCADE,
      CHECK((started_at IS NULL) = (started_driver_id IS NULL))
    );
    CREATE INDEX route_plan_publications_driver
      ON route_plan_publications(driver_id,plan_id);
    CREATE INDEX route_plan_publications_started
      ON route_plan_publications(plan_id) WHERE started_at IS NOT NULL;
    UPDATE rutas_installation SET schema_version=12 WHERE singleton=true;
  `);
}
