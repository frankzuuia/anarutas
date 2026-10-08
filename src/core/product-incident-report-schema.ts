import type { Sql } from "./database";

// Administrative text stays outside the immutable driver/financial record.
export async function migrateProductIncidentReports(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_product_incidents DROP CONSTRAINT route_product_incidents_warehouse_reason_check;
    ALTER TABLE route_product_incidents ADD CONSTRAINT route_product_incidents_warehouse_reason_check
      CHECK(warehouse_reason IN ('special','quality','late_arrival','product_not_ordered'));
    CREATE TABLE IF NOT EXISTS route_product_incident_annotations (
      incident_id uuid PRIMARY KEY REFERENCES route_product_incidents(id),
      comment text CHECK(comment IS NULL OR char_length(comment)<=2000),
      updated_by uuid NOT NULL REFERENCES route_users(id),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    UPDATE rutas_installation SET schema_version=46 WHERE singleton=true;
  `);
}
