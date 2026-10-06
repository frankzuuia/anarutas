import type { Sql } from "./database";

export async function migrateUnitPhotoRetention(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_unit_photos
      ALTER COLUMN expires_at SET DEFAULT (now()+interval '30 days');
    UPDATE route_unit_photos
      SET expires_at=created_at+interval '30 days'
      WHERE expires_at=created_at+interval '15 days';
    UPDATE rutas_installation SET schema_version=44 WHERE singleton=true;
  `);
}
