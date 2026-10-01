import type { Sql } from "./database";

export async function migrateOrderCollections(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_order_payments ADD COLUMN IF NOT EXISTS cash_received numeric NOT NULL DEFAULT 0;
    ALTER TABLE route_order_payments ADD COLUMN IF NOT EXISTS transfer_received numeric NOT NULL DEFAULT 0;
    ALTER TABLE route_order_payments ADD COLUMN IF NOT EXISTS capture_version integer NOT NULL DEFAULT 1;
    -- Transactional migration only: reconstruct components from immutable historical method/received.
    ALTER TABLE route_order_payments DISABLE TRIGGER immutable_payment;
    UPDATE route_order_payments SET cash_received=CASE WHEN method='cash' THEN received ELSE 0 END,
      transfer_received=CASE WHEN method='transfer' THEN received ELSE 0 END WHERE capture_version=1;
    ALTER TABLE route_order_payments ENABLE TRIGGER immutable_payment;
    ALTER TABLE route_order_payments DROP CONSTRAINT IF EXISTS route_order_payments_method_check;
    ALTER TABLE route_order_payments ADD CONSTRAINT route_order_payments_method_check CHECK(method IN ('cash','transfer','credit','mixed'));
    ALTER TABLE route_order_payments DROP CONSTRAINT IF EXISTS payment_capture_version;
    ALTER TABLE route_order_payments ADD CONSTRAINT payment_capture_version CHECK(capture_version IN (1,2));
    ALTER TABLE route_order_payments DROP CONSTRAINT IF EXISTS payment_components;
    ALTER TABLE route_order_payments ADD CONSTRAINT payment_components CHECK(
      cash_received>=0 AND transfer_received>=0 AND cash_received+transfer_received=received AND
      ((method='cash' AND transfer_received=0) OR (method='transfer' AND cash_received=0) OR
       (method='credit' AND cash_received=0 AND transfer_received=0) OR
       (method='mixed' AND capture_version=2 AND cash_received>0 AND transfer_received>0)));
    ALTER TABLE route_order_payments DROP CONSTRAINT IF EXISTS payment_full_capture;
    ALTER TABLE route_order_payments ADD CONSTRAINT payment_full_capture CHECK(capture_version=1 OR
      (change=0 AND (method='credit' OR balance=0)));
    CREATE OR REPLACE FUNCTION verify_payment_components() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS(SELECT 1 FROM unnest(ARRAY[NEW.cash_received,NEW.transfer_received]) amount
        WHERE amount::text IN ('NaN','Infinity','-Infinity') OR amount<0 OR mod(amount,(NEW.currency->>'rounding')::numeric)<>0) THEN
        RAISE EXCEPTION 'PAYMENT_COMPONENT_INVALID' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER verify_payment_components BEFORE INSERT ON route_order_payments FOR EACH ROW EXECUTE FUNCTION verify_payment_components();
    CREATE OR REPLACE FUNCTION require_route_collections() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS(SELECT 1 FROM route_driver_execution_orders o JOIN route_shipments s ON s.id=o.shipment_id
        JOIN route_financial_targets t ON (t.source,t.picking_id,t.order_id)=(s.source,s.picking_id,s.order_id)
        WHERE o.execution_id=NEW.execution_id AND o.status='delivered' AND t.revision>0
          AND NOT EXISTS(SELECT 1 FROM route_order_payments p WHERE (p.execution_id,p.shipment_id)=(o.execution_id,o.shipment_id))) THEN
        RAISE EXCEPTION 'ROUTE_PAYMENTS_MISSING' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER require_route_collections BEFORE INSERT ON route_driver_execution_completions FOR EACH ROW EXECUTE FUNCTION require_route_collections();
    CREATE OR REPLACE FUNCTION verify_settlement_request() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE actual_driver uuid; actual_device uuid;
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SETTLEMENT_IMMUTABLE' USING ERRCODE='42501'; END IF;
      IF TG_OP='INSERT' THEN
        IF jsonb_typeof(NEW.snapshot->'paymentIds') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.snapshot->'totals') IS DISTINCT FROM 'array'
          OR jsonb_array_length(NEW.snapshot->'paymentIds')=0 OR (NEW.scope='order' AND jsonb_array_length(NEW.snapshot->'paymentIds')<>1) THEN
          RAISE EXCEPTION 'SETTLEMENT_SNAPSHOT_INVALID' USING ERRCODE='23514'; END IF;
        SELECT driver_id INTO actual_driver FROM route_driver_executions WHERE id=NEW.execution_id FOR UPDATE;
        SELECT driver_id INTO actual_device FROM route_driver_mobile_devices WHERE id=NEW.device_id;
        IF actual_driver IS DISTINCT FROM NEW.driver_id OR actual_device IS DISTINCT FROM NEW.driver_id
          OR (NEW.scope='route' AND NOT EXISTS(SELECT 1 FROM route_driver_execution_completions WHERE execution_id=NEW.execution_id))
          OR NEW.status<>'pending' THEN RAISE EXCEPTION 'SETTLEMENT_EXECUTION_INVALID' USING ERRCODE='23514'; END IF;
      ELSE
        IF (to_jsonb(NEW)-ARRAY['status','version','decided_at','decided_by','decision_note','decision_command','decision_hash']) IS DISTINCT FROM
           (to_jsonb(OLD)-ARRAY['status','version','decided_at','decided_by','decision_note','decision_command','decision_hash'])
           OR OLD.status<>'pending' OR NEW.status='pending' OR NEW.version<>OLD.version+1 THEN
           RAISE EXCEPTION 'SETTLEMENT_IMMUTABLE' USING ERRCODE='42501'; END IF;
        IF NOT EXISTS(SELECT 1 FROM route_users WHERE id=NEW.decided_by AND active AND role='settlement') THEN
          RAISE EXCEPTION 'SETTLEMENT_ACTOR_DENIED' USING ERRCODE='42501'; END IF;
        IF NOT EXISTS(SELECT 1 FROM route_settlement_items WHERE request_id=NEW.id) OR
          EXISTS(SELECT 1 FROM route_settlement_items i LEFT JOIN route_settlement_claims c ON c.payment_id=i.payment_id AND c.request_id=i.request_id
            WHERE i.request_id=NEW.id AND c.payment_id IS NULL) THEN RAISE EXCEPTION 'SETTLEMENT_CLAIM_LOST' USING ERRCODE='23514'; END IF;
        IF (SELECT jsonb_agg(payment_id::text ORDER BY payment_id::text) FROM route_settlement_items WHERE request_id=NEW.id)
          IS DISTINCT FROM NEW.snapshot->'paymentIds' THEN RAISE EXCEPTION 'SETTLEMENT_SNAPSHOT_INVALID' USING ERRCODE='23514'; END IF;
      END IF;
      RETURN NEW;
    END $$;
    UPDATE rutas_installation SET schema_version=39 WHERE singleton=true;
  `);
}
