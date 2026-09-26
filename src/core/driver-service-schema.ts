import type { Sql } from "./database";

// Version 21 adds operational projections without changing the published route
// snapshot or the immutable history already recorded by version 20.
export async function migrateDriverService(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_driver_execution_stops
      ADD COLUMN IF NOT EXISTS visit_state text NOT NULL DEFAULT 'open',
      ADD COLUMN IF NOT EXISTS visit_sequence integer NOT NULL DEFAULT 0;
    UPDATE route_driver_execution_stops
       SET visit_state='arrived',visit_sequence=1
     WHERE arrived_at IS NOT NULL AND visit_sequence=0;
    ALTER TABLE route_driver_execution_stops
      DROP CONSTRAINT IF EXISTS execution_stop_visit_state,
      DROP CONSTRAINT IF EXISTS execution_stop_visit_sequence,
      DROP CONSTRAINT IF EXISTS execution_stop_active_arrival;
    ALTER TABLE route_driver_execution_stops
      ADD CONSTRAINT execution_stop_visit_state
        CHECK(visit_state IN ('open','arrived')),
      ADD CONSTRAINT execution_stop_visit_sequence
        CHECK(visit_sequence>=0),
      ADD CONSTRAINT execution_stop_active_arrival
        CHECK((visit_state='arrived')=(arrived_at IS NOT NULL));
    CREATE UNIQUE INDEX IF NOT EXISTS execution_stop_identity_idx
      ON route_driver_execution_stops(execution_id,id);

    ALTER TABLE route_driver_stop_events
      ADD COLUMN IF NOT EXISTS visit_sequence integer;
    -- The v20 immutable-event trigger must be removed only within this DDL
    -- transaction while historical arrivals receive their visit number.
    DROP TRIGGER IF EXISTS immutable_driver_event ON route_driver_stop_events;
    UPDATE route_driver_stop_events SET visit_sequence=1
      WHERE kind='arrival' AND visit_sequence IS NULL;
    CREATE OR REPLACE TRIGGER immutable_driver_event
      BEFORE UPDATE OR DELETE ON route_driver_stop_events
      FOR EACH ROW EXECUTE FUNCTION preserve_driver_event();
    ALTER TABLE route_driver_stop_events
      DROP CONSTRAINT IF EXISTS route_driver_stop_events_kind_check,
      DROP CONSTRAINT IF EXISTS execution_event_visit_sequence,
      DROP CONSTRAINT IF EXISTS execution_arrival_has_visit,
      DROP CONSTRAINT IF EXISTS execution_exit_has_visit;
    ALTER TABLE route_driver_stop_events
      ADD CONSTRAINT route_driver_stop_events_kind_check
        CHECK(kind IN ('arrival','repoint','visit_exit')),
      ADD CONSTRAINT execution_event_visit_sequence
        CHECK(visit_sequence IS NULL OR visit_sequence>0),
      ADD CONSTRAINT execution_arrival_has_visit
        CHECK(kind<>'arrival' OR visit_sequence IS NOT NULL),
      ADD CONSTRAINT execution_exit_has_visit
        CHECK(kind<>'visit_exit' OR visit_sequence IS NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS execution_stop_visit_arrival
      ON route_driver_stop_events(execution_id,stop_id,visit_sequence)
      WHERE kind='arrival';
    CREATE UNIQUE INDEX IF NOT EXISTS execution_stop_visit_exit
      ON route_driver_stop_events(execution_id,stop_id,visit_sequence)
      WHERE kind='visit_exit';
    DROP INDEX IF EXISTS execution_stop_single_arrival;

    -- No FK to route_shipments: plan deletion must not erase operational history.
    CREATE TABLE IF NOT EXISTS route_driver_execution_orders (
      execution_id uuid NOT NULL,
      stop_id uuid NOT NULL,
      shipment_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'open'
        CHECK(status IN ('open','closed_pending','rejected','rescheduled','delivered')),
      version integer NOT NULL DEFAULT 1 CHECK(version>0),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(execution_id,shipment_id),
      FOREIGN KEY(execution_id,stop_id)
        REFERENCES route_driver_execution_stops(execution_id,id)
    );
    INSERT INTO route_driver_execution_orders(execution_id,stop_id,shipment_id)
      SELECT s.execution_id,s.id,shipment.shipment_id
        FROM route_driver_execution_stops s
        CROSS JOIN LATERAL unnest(s.shipment_ids) AS shipment(shipment_id)
      ON CONFLICT(execution_id,shipment_id) DO NOTHING;
    CREATE INDEX IF NOT EXISTS driver_execution_orders_by_stop
      ON route_driver_execution_orders(execution_id,stop_id,status);
    CREATE OR REPLACE FUNCTION verify_driver_order_membership()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NOT EXISTS(
          SELECT 1 FROM route_driver_execution_stops s
           WHERE s.execution_id=NEW.execution_id AND s.id=NEW.stop_id
             AND NEW.shipment_id=ANY(s.shipment_ids)
        ) THEN
          RAISE EXCEPTION 'DRIVER_ORDER_NOT_IN_STOP' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$;
    CREATE OR REPLACE TRIGGER verify_driver_order_membership
      BEFORE INSERT OR UPDATE OF execution_id,stop_id,shipment_id
      ON route_driver_execution_orders
      FOR EACH ROW EXECUTE FUNCTION verify_driver_order_membership();
    CREATE OR REPLACE FUNCTION preserve_driver_stop_shipments()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.shipment_ids IS DISTINCT FROM OLD.shipment_ids THEN
          RAISE EXCEPTION 'DRIVER_STOP_SHIPMENTS_IMMUTABLE' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$;
    CREATE OR REPLACE TRIGGER preserve_driver_stop_shipments
      BEFORE UPDATE OF shipment_ids ON route_driver_execution_stops
      FOR EACH ROW EXECUTE FUNCTION preserve_driver_stop_shipments();
    CREATE OR REPLACE FUNCTION seed_driver_execution_orders()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO route_driver_execution_orders(execution_id,stop_id,shipment_id)
          SELECT NEW.execution_id,NEW.id,shipment.shipment_id
            FROM unnest(NEW.shipment_ids) AS shipment(shipment_id);
        RETURN NEW;
      END $$;
    CREATE OR REPLACE TRIGGER seed_driver_execution_orders
      AFTER INSERT ON route_driver_execution_stops
      FOR EACH ROW EXECUTE FUNCTION seed_driver_execution_orders();
    CREATE OR REPLACE TRIGGER panel_changed
      AFTER INSERT OR UPDATE ON route_driver_execution_orders
      FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
    UPDATE rutas_installation SET schema_version=21 WHERE singleton=true;
  `);
}
