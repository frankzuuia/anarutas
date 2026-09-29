import type { Sql } from "./database";

export async function migrateProductIncidentPhotos(sql: Sql) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS route_product_incident_photos (
      incident_id uuid NOT NULL REFERENCES route_product_incidents(id),
      position smallint NOT NULL CHECK(position IN (2,3)),
      evidence_id uuid NOT NULL UNIQUE,
      evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
      evidence_bytes integer NOT NULL CHECK(evidence_bytes>0),
      PRIMARY KEY(incident_id,position)
    );
    CREATE OR REPLACE FUNCTION validate_extra_product_photo() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE first_id uuid;
    BEGIN
      IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'PRODUCT_EVIDENCE_IMMUTABLE' USING ERRCODE='42501'; END IF;
      SELECT evidence_id INTO first_id FROM route_product_incidents WHERE id=NEW.incident_id FOR UPDATE;
      IF first_id IS NULL OR EXISTS(SELECT 1 FROM route_product_incidents WHERE evidence_id=NEW.evidence_id) THEN
        RAISE EXCEPTION 'INVALID_PRODUCT_EVIDENCE' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER immutable_product_photo BEFORE INSERT OR UPDATE OR DELETE ON route_product_incident_photos
      FOR EACH ROW EXECUTE FUNCTION validate_extra_product_photo();
    UPDATE rutas_installation SET schema_version=28 WHERE singleton=true;
  `);
}
