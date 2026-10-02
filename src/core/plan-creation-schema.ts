import type { Sql } from "./database";

export async function migratePlanCreations(sql: Sql) {
  await sql.query(`
    DO $$ DECLARE constraint_name text; BEGIN
      FOR constraint_name IN
        SELECT conname FROM pg_constraint
         WHERE conrelid='route_plans'::regclass AND contype='u'
           AND conkey=ARRAY[(SELECT attnum FROM pg_attribute
             WHERE attrelid='route_plans'::regclass AND attname='service_date')]::smallint[]
      LOOP
        EXECUTE format('ALTER TABLE route_plans DROP CONSTRAINT %I',constraint_name);
      END LOOP;
    END $$;
    CREATE INDEX IF NOT EXISTS route_plans_operation_order
      ON route_plans(service_date DESC,created_at DESC,id DESC) WHERE archived_at IS NULL;
    CREATE INDEX IF NOT EXISTS route_publications_started_driver
      ON route_plan_publications(started_driver_id,plan_id,vehicle_id)
      WHERE started_at IS NOT NULL AND revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS route_publications_started_vehicle
      ON route_plan_publications(vehicle_id,plan_id,started_driver_id)
      WHERE started_at IS NOT NULL AND revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS route_plan_creation_requests (
      actor_id uuid NOT NULL REFERENCES route_users(id),
      command_id uuid NOT NULL,
      -- Intentionally no plan FK: deletion must retain the creation tombstone.
      plan_id uuid NOT NULL UNIQUE,
      requested_date date NOT NULL,
      requested_label text NOT NULL CHECK(char_length(requested_label) BETWEEN 1 AND 120),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(actor_id,command_id)
    );
    UPDATE rutas_installation SET schema_version=42 WHERE singleton=true;
  `);
}
