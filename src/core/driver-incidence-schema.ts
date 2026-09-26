import type { Sql } from "./database";

// Version 22 adds durable operational cases without changing publication snapshots.
export async function migrateDriverIncidences(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_driver_stop_events
      DROP CONSTRAINT IF EXISTS route_driver_stop_events_kind_check,
      DROP CONSTRAINT IF EXISTS execution_service_has_visit;
    ALTER TABLE route_driver_stop_events
      ADD CONSTRAINT route_driver_stop_events_kind_check
        CHECK(kind IN ('arrival','repoint','visit_exit','delivery','rejection','reschedule','customer_closed')),
      ADD CONSTRAINT execution_service_has_visit
        CHECK(kind NOT IN ('delivery','rejection','reschedule','customer_closed') OR visit_sequence IS NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS driver_execution_actor_identity
      ON route_driver_executions(id,driver_id);
    CREATE UNIQUE INDEX IF NOT EXISTS driver_execution_order_stop_identity
      ON route_driver_execution_orders(execution_id,stop_id,shipment_id);

    CREATE TABLE IF NOT EXISTS route_driver_service_incidents (
      id uuid PRIMARY KEY,
      execution_id uuid NOT NULL,
      stop_id uuid NOT NULL,
      driver_id uuid NOT NULL,
      kind text NOT NULL CHECK(kind IN ('customer_closed','order_rejected','rescheduled')),
      status text NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','completed','handled','resolved_by_admin')),
      reason_code text CHECK(reason_code IN ('poor_quality','late_arrival','other')),
      note text CHECK(note IS NULL OR char_length(note)<=2000),
      visit_sequence integer NOT NULL CHECK(visit_sequence>0),
      occurred_at timestamptz NOT NULL DEFAULT now(),
      event_date date NOT NULL,
      timezone text NOT NULL CHECK(char_length(timezone) BETWEEN 1 AND 100),
      snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
      evidence_id uuid,
      terminal_at timestamptz,
      admin_resolved_by uuid REFERENCES route_users(id),
      version integer NOT NULL DEFAULT 1 CHECK(version>0),
      UNIQUE(id,execution_id,stop_id),
      FOREIGN KEY(execution_id,stop_id)
        REFERENCES route_driver_execution_stops(execution_id,id),
      FOREIGN KEY(execution_id,driver_id)
        REFERENCES route_driver_executions(id,driver_id),
      CHECK((kind='order_rejected')=(reason_code IS NOT NULL)),
      CHECK(reason_code IS DISTINCT FROM 'other' OR nullif(btrim(note),'') IS NOT NULL),
      CHECK(kind<>'customer_closed' OR evidence_id IS NOT NULL),
      CHECK((status='active')=(terminal_at IS NULL)),
      CHECK((status='resolved_by_admin')=(admin_resolved_by IS NOT NULL)),
      CHECK(status<>'resolved_by_admin' OR kind IN ('order_rejected','rescheduled'))
    );
    CREATE INDEX IF NOT EXISTS driver_service_incidents_by_date
      ON route_driver_service_incidents(event_date,occurred_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS driver_service_incidents_by_driver
      ON route_driver_service_incidents(driver_id,event_date,occurred_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS driver_service_incidents_by_execution
      ON route_driver_service_incidents(execution_id,status);
    CREATE OR REPLACE FUNCTION preserve_driver_incident_identity()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'DRIVER_INCIDENT_IMMUTABLE' USING ERRCODE='42501';
        END IF;
        IF (NEW.id,NEW.execution_id,NEW.stop_id,NEW.driver_id,NEW.kind,
            NEW.reason_code,NEW.note,NEW.visit_sequence,NEW.occurred_at,
            NEW.event_date,NEW.timezone,NEW.snapshot,NEW.evidence_id)
           IS DISTINCT FROM
           (OLD.id,OLD.execution_id,OLD.stop_id,OLD.driver_id,OLD.kind,
            OLD.reason_code,OLD.note,OLD.visit_sequence,OLD.occurred_at,
            OLD.event_date,OLD.timezone,OLD.snapshot,OLD.evidence_id) THEN
          RAISE EXCEPTION 'DRIVER_INCIDENT_IMMUTABLE' USING ERRCODE='42501';
        END IF;
        RETURN NEW;
      END $$;
    CREATE OR REPLACE TRIGGER immutable_driver_incident_identity
      BEFORE UPDATE OR DELETE ON route_driver_service_incidents
      FOR EACH ROW EXECUTE FUNCTION preserve_driver_incident_identity();

    -- The FK from incident to evidence is deferred so both records can be
    -- inserted atomically, while a closed-business case cannot commit photo-less.
    CREATE TABLE IF NOT EXISTS route_driver_incident_evidence (
      id uuid PRIMARY KEY,
      incident_id uuid NOT NULL UNIQUE REFERENCES route_driver_service_incidents(id),
      storage_key text NOT NULL UNIQUE CHECK(storage_key ~ '^[0-9a-f-]{36}\\.webp$'),
      content_hash text NOT NULL CHECK(char_length(content_hash)=64),
      bytes integer NOT NULL CHECK(bytes>0 AND bytes<=1572864),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
      revoked_at timestamptz,
      removed_at timestamptz,
      UNIQUE(id,incident_id),
      CHECK(expires_at=created_at+interval '24 hours')
    );
    ALTER TABLE route_driver_service_incidents
      DROP CONSTRAINT IF EXISTS driver_incident_owns_evidence;
    ALTER TABLE route_driver_service_incidents
      ADD CONSTRAINT driver_incident_owns_evidence
        FOREIGN KEY(evidence_id,id)
        REFERENCES route_driver_incident_evidence(id,incident_id)
        DEFERRABLE INITIALLY DEFERRED;
    CREATE INDEX IF NOT EXISTS driver_incident_evidence_expiry
      ON route_driver_incident_evidence(expires_at,id)
      WHERE removed_at IS NULL;
    CREATE OR REPLACE FUNCTION preserve_driver_incident_evidence_identity()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'DRIVER_INCIDENT_EVIDENCE_IMMUTABLE' USING ERRCODE='42501';
        END IF;
        IF (NEW.id,NEW.incident_id,NEW.storage_key,NEW.content_hash,
            NEW.bytes,NEW.created_at,NEW.expires_at)
           IS DISTINCT FROM
           (OLD.id,OLD.incident_id,OLD.storage_key,OLD.content_hash,
            OLD.bytes,OLD.created_at,OLD.expires_at)
           OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
           OR (OLD.removed_at IS NOT NULL AND NEW.removed_at IS DISTINCT FROM OLD.removed_at) THEN
          RAISE EXCEPTION 'DRIVER_INCIDENT_EVIDENCE_IMMUTABLE' USING ERRCODE='42501';
        END IF;
        RETURN NEW;
      END $$;
    CREATE OR REPLACE TRIGGER immutable_driver_incident_evidence_identity
      BEFORE UPDATE OR DELETE ON route_driver_incident_evidence
      FOR EACH ROW EXECUTE FUNCTION preserve_driver_incident_evidence_identity();

    CREATE TABLE IF NOT EXISTS route_driver_incident_orders (
      incident_id uuid NOT NULL,
      execution_id uuid NOT NULL,
      stop_id uuid NOT NULL,
      shipment_id uuid NOT NULL,
      open_case boolean NOT NULL DEFAULT true,
      PRIMARY KEY(incident_id,shipment_id),
      FOREIGN KEY(incident_id,execution_id,stop_id)
        REFERENCES route_driver_service_incidents(id,execution_id,stop_id),
      FOREIGN KEY(execution_id,stop_id,shipment_id)
        REFERENCES route_driver_execution_orders(execution_id,stop_id,shipment_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS driver_incident_one_open_case_per_order
      ON route_driver_incident_orders(execution_id,shipment_id)
      WHERE open_case;
    CREATE INDEX IF NOT EXISTS driver_incident_orders_by_execution
      ON route_driver_incident_orders(execution_id,stop_id,open_case);

    -- Checked at COMMIT because an incident is inserted before its order links.
    -- A closed-business incident must always cover every order at that stop.
    CREATE OR REPLACE FUNCTION verify_driver_incident_coverage()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NOT EXISTS(
          SELECT 1 FROM route_driver_incident_orders io
          WHERE io.incident_id=NEW.id
        ) THEN
          RAISE EXCEPTION 'DRIVER_INCIDENT_WITHOUT_ORDERS' USING ERRCODE='23514';
        END IF;
        IF NEW.kind='customer_closed' AND EXISTS(
          SELECT 1 FROM route_driver_execution_orders eo
          WHERE eo.execution_id=NEW.execution_id AND eo.stop_id=NEW.stop_id
            AND NOT EXISTS(
              SELECT 1 FROM route_driver_incident_orders io
              WHERE io.incident_id=NEW.id AND io.shipment_id=eo.shipment_id
            )
        ) THEN
          RAISE EXCEPTION 'DRIVER_CLOSED_INCIDENT_INCOMPLETE' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$;
    DROP TRIGGER IF EXISTS driver_incident_coverage ON route_driver_service_incidents;
    CREATE CONSTRAINT TRIGGER driver_incident_coverage
      AFTER INSERT OR UPDATE OF kind ON route_driver_service_incidents
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION verify_driver_incident_coverage();
    CREATE OR REPLACE FUNCTION preserve_driver_incident_order_identity()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'DRIVER_INCIDENT_ORDER_IMMUTABLE' USING ERRCODE='42501';
        END IF;
        IF (NEW.incident_id,NEW.execution_id,NEW.stop_id,NEW.shipment_id)
             IS DISTINCT FROM
           (OLD.incident_id,OLD.execution_id,OLD.stop_id,OLD.shipment_id) THEN
          RAISE EXCEPTION 'DRIVER_INCIDENT_ORDER_IMMUTABLE' USING ERRCODE='42501';
        END IF;
        RETURN NEW;
      END $$;
    CREATE OR REPLACE TRIGGER immutable_driver_incident_order_identity
      BEFORE UPDATE OR DELETE ON route_driver_incident_orders
      FOR EACH ROW EXECUTE FUNCTION preserve_driver_incident_order_identity();

    CREATE TABLE IF NOT EXISTS route_driver_incident_events (
      id uuid PRIMARY KEY,
      incident_id uuid NOT NULL REFERENCES route_driver_service_incidents(id),
      kind text NOT NULL CHECK(kind IN ('opened','retry_arrived','retry_abandoned',
        'completed','handled','resolved_by_admin','evidence_expired')),
      actor_type text NOT NULL CHECK(actor_type IN ('driver','admin','system')),
      actor_driver_id uuid REFERENCES route_drivers(id),
      actor_admin_id uuid REFERENCES route_users(id),
      occurred_at timestamptz NOT NULL DEFAULT now(),
      details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
      CHECK((actor_type='driver' AND actor_driver_id IS NOT NULL AND actor_admin_id IS NULL)
        OR (actor_type='admin' AND actor_admin_id IS NOT NULL AND actor_driver_id IS NULL)
        OR (actor_type='system' AND actor_driver_id IS NULL AND actor_admin_id IS NULL))
    );
    CREATE INDEX IF NOT EXISTS driver_incident_events_history
      ON route_driver_incident_events(incident_id,occurred_at,id);
    CREATE OR REPLACE TRIGGER immutable_driver_incident_event
      BEFORE UPDATE OR DELETE ON route_driver_incident_events
      FOR EACH ROW EXECUTE FUNCTION preserve_driver_event();
    CREATE OR REPLACE TRIGGER panel_changed
      AFTER INSERT OR UPDATE ON route_driver_service_incidents
      FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
    CREATE OR REPLACE TRIGGER panel_changed
      AFTER INSERT OR UPDATE ON route_driver_incident_orders
      FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
    CREATE OR REPLACE TRIGGER panel_changed
      AFTER INSERT OR UPDATE ON route_driver_incident_evidence
      FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
    UPDATE rutas_installation SET schema_version=22 WHERE singleton=true;
  `);
}
