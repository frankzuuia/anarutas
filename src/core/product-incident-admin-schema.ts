import type { Sql } from "./database";

export async function migrateProductIncidentAdminCancellation(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_product_incidents ADD COLUMN IF NOT EXISTS canceled_by_admin uuid REFERENCES route_users(id);
    ALTER TABLE route_product_incidents ADD COLUMN IF NOT EXISTS report_removed_at timestamptz;
    ALTER TABLE route_product_incidents ADD COLUMN IF NOT EXISTS report_removed_by uuid REFERENCES route_users(id);
    ALTER TABLE route_product_incidents DROP CONSTRAINT IF EXISTS product_incident_report_removal_consistent;
    ALTER TABLE route_product_incidents ADD CONSTRAINT product_incident_report_removal_consistent
      CHECK((report_removed_at IS NULL)=(report_removed_by IS NULL));
    ALTER TABLE route_product_incidents DROP CONSTRAINT product_incident_cancellation_consistent;
    ALTER TABLE route_product_incidents ADD CONSTRAINT product_incident_cancellation_consistent CHECK(
      (status='canceled' AND canceled_at IS NOT NULL AND num_nonnulls(canceled_by,canceled_by_admin)=1)
      OR (status<>'canceled' AND canceled_at IS NULL AND canceled_by IS NULL AND canceled_by_admin IS NULL));
    CREATE OR REPLACE FUNCTION preserve_product_incident() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PRODUCT_INCIDENT_IMMUTABLE' USING ERRCODE='42501'; END IF;
      IF (to_jsonb(NEW)-ARRAY['status','version','resolved_at','resolved_by','resolution_note','department','concept',
        'kind','warehouse_reason','product','unit','quantity','note','form_comments','form_updated','additional_note',
        'canceled_at','canceled_by','canceled_by_admin','report_removed_at','report_removed_by'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','resolved_at','resolved_by','resolution_note','department','concept',
        'kind','warehouse_reason','product','unit','quantity','note','form_comments','form_updated','additional_note',
        'canceled_at','canceled_by','canceled_by_admin','report_removed_at','report_removed_by']) THEN
        RAISE EXCEPTION 'PRODUCT_INCIDENT_IMMUTABLE' USING ERRCODE='42501';
      END IF;
      IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'PRODUCT_INCIDENT_VERSION' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    UPDATE rutas_installation SET schema_version=30 WHERE singleton=true;
  `);
}
