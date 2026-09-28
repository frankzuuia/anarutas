import type { Sql } from "./database";

export async function migrateProductIncidents(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_plans ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    CREATE INDEX IF NOT EXISTS route_plans_active_date ON route_plans(service_date DESC) WHERE archived_at IS NULL;
    CREATE TABLE IF NOT EXISTS route_product_incidents (
      id uuid PRIMARY KEY,
      execution_id uuid NOT NULL,
      stop_id uuid NOT NULL,
      shipment_id uuid NOT NULL,
      driver_id uuid NOT NULL,
      visit_sequence integer NOT NULL CHECK(visit_sequence>0),
      kind text NOT NULL CHECK(kind IN ('shortage_validation','shortage_warehouse','replacement_quality','replacement_wrong_product','return')),
      warehouse_reason text CHECK(warehouse_reason IN ('special','quality','late_arrival')),
      line_index integer CHECK(line_index>=0),
      product text NOT NULL CHECK(char_length(btrim(product)) BETWEEN 1 AND 300),
      unit text NOT NULL CHECK(char_length(btrim(unit)) BETWEEN 1 AND 40),
      quantity numeric(18,6) NOT NULL CHECK(quantity>0),
      source_quantity numeric(18,6) CHECK(source_quantity>0),
      note text CHECK(char_length(note)<=2000),
      order_name text NOT NULL,
      occurred_at timestamptz NOT NULL,
      event_date date NOT NULL,
      timezone text NOT NULL,
      snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
      status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved')),
      version integer NOT NULL DEFAULT 1 CHECK(version>0),
      resolved_at timestamptz,
      resolved_by uuid REFERENCES route_users(id),
      resolution_note text CHECK(char_length(resolution_note)<=2000),
      department text CHECK(char_length(department)<=120),
      concept text CHECK(char_length(concept)<=120),
      evidence_id uuid UNIQUE,
      evidence_hash text,
      evidence_bytes integer CHECK(evidence_bytes>0),
      CHECK((evidence_id IS NULL AND evidence_hash IS NULL AND evidence_bytes IS NULL)
        OR (evidence_id IS NOT NULL AND evidence_hash IS NOT NULL AND evidence_bytes IS NOT NULL)),
      FOREIGN KEY(execution_id,stop_id,shipment_id) REFERENCES route_driver_execution_orders(execution_id,stop_id,shipment_id),
      FOREIGN KEY(execution_id,driver_id) REFERENCES route_driver_executions(id,driver_id),
      CHECK((kind IN ('shortage_validation','shortage_warehouse'))=(line_index IS NULL)),
      CHECK((kind='shortage_warehouse')=(warehouse_reason IS NOT NULL)),
      CHECK((line_index IS NULL)=(source_quantity IS NULL)),
      CHECK(line_index IS NULL OR evidence_id IS NOT NULL),
      CHECK(source_quantity IS NULL OR quantity<=source_quantity),
      CHECK((status='resolved')=(resolved_at IS NOT NULL AND resolved_by IS NOT NULL)),
      CHECK(status<>'pending' OR (resolved_at IS NULL AND resolved_by IS NULL))
    );
    CREATE INDEX IF NOT EXISTS product_incidents_history ON route_product_incidents(event_date,occurred_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS product_incidents_driver ON route_product_incidents(driver_id,event_date,occurred_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS product_incidents_line ON route_product_incidents(execution_id,shipment_id,line_index);
    CREATE INDEX IF NOT EXISTS product_incidents_pending ON route_product_incidents(occurred_at DESC,id DESC) WHERE status='pending';
    CREATE OR REPLACE FUNCTION validate_product_incident_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE source_line jsonb; total numeric;
    BEGIN
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
          WHERE execution_id=NEW.execution_id AND shipment_id=NEW.shipment_id AND line_index=NEW.line_index;
        IF total+NEW.quantity>NEW.source_quantity THEN
          RAISE EXCEPTION 'INCIDENT_QUANTITY_EXCEEDED' USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER validate_product_incident BEFORE INSERT ON route_product_incidents
      FOR EACH ROW EXECUTE FUNCTION validate_product_incident_quantity();
    CREATE OR REPLACE FUNCTION preserve_product_incident() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PRODUCT_INCIDENT_IMMUTABLE' USING ERRCODE='42501'; END IF;
      IF (to_jsonb(NEW)-ARRAY['status','version','resolved_at','resolved_by','resolution_note','department','concept'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','resolved_at','resolved_by','resolution_note','department','concept']) THEN
        RAISE EXCEPTION 'PRODUCT_INCIDENT_IMMUTABLE' USING ERRCODE='42501';
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER immutable_product_incident BEFORE UPDATE OR DELETE ON route_product_incidents
      FOR EACH ROW EXECUTE FUNCTION preserve_product_incident();
    CREATE OR REPLACE TRIGGER panel_changed AFTER INSERT OR UPDATE ON route_product_incidents
      FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
    UPDATE rutas_installation SET schema_version=27 WHERE singleton=true;
  `);
}
