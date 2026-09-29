import type { Sql } from "./database";

export async function migrateProductIncidentAmendments(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_product_incidents DROP CONSTRAINT IF EXISTS route_product_incidents_status_check;
    ALTER TABLE route_product_incidents ADD CONSTRAINT route_product_incidents_status_check
      CHECK(status IN ('pending','resolved','canceled'));
    ALTER TABLE route_product_incidents ADD COLUMN IF NOT EXISTS form_comments jsonb NOT NULL DEFAULT '[]'::jsonb
      CHECK(jsonb_typeof(form_comments)='array');
    ALTER TABLE route_product_incidents ADD COLUMN IF NOT EXISTS form_updated boolean NOT NULL DEFAULT false;
    ALTER TABLE route_product_incidents ADD COLUMN IF NOT EXISTS additional_note text
      CHECK(char_length(additional_note)<=2000);
    ALTER TABLE route_product_incidents ADD COLUMN IF NOT EXISTS canceled_at timestamptz;
    ALTER TABLE route_product_incidents ADD COLUMN IF NOT EXISTS canceled_by uuid REFERENCES route_drivers(id);
    ALTER TABLE route_product_incidents DROP CONSTRAINT IF EXISTS product_incident_cancellation_consistent;
    ALTER TABLE route_product_incidents ADD CONSTRAINT product_incident_cancellation_consistent
      CHECK((status='canceled')=(canceled_at IS NOT NULL AND canceled_by IS NOT NULL));
    CREATE TABLE IF NOT EXISTS route_product_incident_changes (
      id bigserial PRIMARY KEY,
      incident_id uuid NOT NULL REFERENCES route_product_incidents(id),
      command_id uuid,
      actor_id uuid,
      before_record jsonb NOT NULL,
      after_record jsonb NOT NULL,
      changed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS product_incident_changes_incident ON route_product_incident_changes(incident_id,id);
    CREATE OR REPLACE FUNCTION preserve_product_incident() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PRODUCT_INCIDENT_IMMUTABLE' USING ERRCODE='42501'; END IF;
      IF (to_jsonb(NEW)-ARRAY['status','version','resolved_at','resolved_by','resolution_note','department','concept',
        'kind','warehouse_reason','product','unit','quantity','note','form_comments','form_updated','additional_note','canceled_at','canceled_by'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','resolved_at','resolved_by','resolution_note','department','concept',
        'kind','warehouse_reason','product','unit','quantity','note','form_comments','form_updated','additional_note','canceled_at','canceled_by']) THEN
        RAISE EXCEPTION 'PRODUCT_INCIDENT_IMMUTABLE' USING ERRCODE='42501';
      END IF;
      IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'PRODUCT_INCIDENT_VERSION' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE FUNCTION validate_product_incident_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE source_line jsonb; total numeric;
    BEGIN
      IF TG_OP='UPDATE' AND NEW.status='resolved' THEN RETURN NEW; END IF;
      PERFORM 1 FROM route_driver_execution_orders WHERE execution_id=NEW.execution_id
        AND stop_id=NEW.stop_id AND shipment_id=NEW.shipment_id FOR UPDATE;
      IF NEW.line_index IS NOT NULL THEN
        SELECT o->'lines'->NEW.line_index INTO source_line
          FROM route_driver_executions e JOIN route_plan_publications p ON p.plan_id=e.plan_id
            AND p.vehicle_id=e.vehicle_id AND p.revision=e.publication_revision
          CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'orders') o
          WHERE e.id=NEW.execution_id AND o->>'id'=NEW.shipment_id::text;
        IF source_line IS NULL OR (source_line->>'quantity')::numeric IS DISTINCT FROM NEW.source_quantity
          OR source_line->>'name' IS DISTINCT FROM NEW.product OR source_line->>'unit' IS DISTINCT FROM NEW.unit THEN
          RAISE EXCEPTION 'INVALID_PRODUCT_LINE' USING ERRCODE='23514';
        END IF;
        SELECT COALESCE(sum(quantity),0) INTO total FROM route_product_incidents
          WHERE execution_id=NEW.execution_id AND shipment_id=NEW.shipment_id AND line_index=NEW.line_index
            AND id<>NEW.id AND status<>'canceled';
        IF NEW.status<>'canceled' AND total+NEW.quantity>NEW.source_quantity THEN
          RAISE EXCEPTION 'INCIDENT_QUANTITY_EXCEEDED' USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS validate_product_incident ON route_product_incidents;
    CREATE TRIGGER validate_product_incident BEFORE INSERT OR UPDATE OF quantity,status ON route_product_incidents
      FOR EACH ROW EXECUTE FUNCTION validate_product_incident_quantity();
    CREATE OR REPLACE FUNCTION log_product_incident_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO route_product_incident_changes(incident_id,command_id,actor_id,before_record,after_record)
      VALUES(NEW.id,nullif(current_setting('ana.product_incident_command_id',true),'')::uuid,
        nullif(current_setting('ana.product_incident_actor_id',true),'')::uuid,to_jsonb(OLD),to_jsonb(NEW));
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS product_incident_change ON route_product_incidents;
    CREATE TRIGGER product_incident_change AFTER UPDATE ON route_product_incidents
      FOR EACH ROW EXECUTE FUNCTION log_product_incident_change();
    CREATE OR REPLACE FUNCTION preserve_product_incident_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'PRODUCT_INCIDENT_CHANGE_IMMUTABLE' USING ERRCODE='42501';
    END $$;
    DROP TRIGGER IF EXISTS immutable_product_incident_change ON route_product_incident_changes;
    CREATE TRIGGER immutable_product_incident_change BEFORE UPDATE OR DELETE ON route_product_incident_changes
      FOR EACH ROW EXECUTE FUNCTION preserve_product_incident_change();
    UPDATE rutas_installation SET schema_version=29 WHERE singleton=true;
  `);
}
