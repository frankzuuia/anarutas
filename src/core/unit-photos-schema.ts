import type { Sql } from "./database";

export async function migrateUnitPhotos(sql: Sql) {
  await sql.query(`
    CREATE TABLE route_unit_photos (
      id uuid PRIMARY KEY,
      plan_id uuid NOT NULL,
      vehicle_id uuid NOT NULL,
      driver_id uuid NOT NULL REFERENCES route_drivers(id),
      storage_key text NOT NULL UNIQUE CHECK(storage_key ~ '^[0-9a-f-]{36}\\.webp$'),
      content_hash text NOT NULL CHECK(char_length(content_hash)=64),
      bytes integer NOT NULL CHECK(bytes > 0 AND bytes <= 1572864),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 days'),
      FOREIGN KEY(plan_id,vehicle_id)
        REFERENCES route_plan_vehicles(plan_id,vehicle_id) ON DELETE CASCADE,
      UNIQUE(plan_id,vehicle_id,driver_id,content_hash)
    );
    CREATE INDEX route_unit_photos_vehicle_date
      ON route_unit_photos(vehicle_id,created_at DESC);
    CREATE INDEX route_unit_photos_expiry ON route_unit_photos(expires_at);
    UPDATE rutas_installation SET schema_version=14 WHERE singleton=true;
  `);
}
