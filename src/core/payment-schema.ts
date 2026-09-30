import type { Sql } from "./database";

export async function migratePayments(sql: Sql) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS route_finance_execution_orders (
      execution_id uuid NOT NULL REFERENCES route_driver_executions(id), shipment_id uuid NOT NULL,
      details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'), PRIMARY KEY(execution_id,shipment_id)
    );
    INSERT INTO route_finance_execution_orders(execution_id,shipment_id,details)
      SELECT e.id,(o->>'id')::uuid,o FROM route_driver_executions e
      JOIN route_plan_publications p ON (p.plan_id,p.vehicle_id,p.revision)=(e.plan_id,e.vehicle_id,e.publication_revision)
      CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'orders') o ON CONFLICT DO NOTHING;
    CREATE OR REPLACE FUNCTION capture_finance_execution_orders() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO route_finance_execution_orders(execution_id,shipment_id,details)
      SELECT NEW.id,(o->>'id')::uuid,o FROM route_plan_publications p
      CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'orders') o
      WHERE (p.plan_id,p.vehicle_id,p.revision)=(NEW.plan_id,NEW.vehicle_id,NEW.publication_revision);
      RETURN NULL;
    END $$;
    CREATE OR REPLACE TRIGGER capture_finance_orders AFTER INSERT ON route_driver_executions
      FOR EACH ROW EXECUTE FUNCTION capture_finance_execution_orders();
    CREATE OR REPLACE TRIGGER immutable_finance_orders BEFORE UPDATE OR DELETE ON route_finance_execution_orders
      FOR EACH ROW EXECUTE FUNCTION preserve_driver_event();
    CREATE TABLE IF NOT EXISTS route_order_payments (
      id uuid PRIMARY KEY, execution_id uuid NOT NULL, shipment_id uuid NOT NULL,
      driver_id uuid NOT NULL REFERENCES route_drivers(id), device_id uuid NOT NULL REFERENCES route_driver_mobile_devices(id),
      command_id uuid NOT NULL, request_hash text NOT NULL CHECK(length(request_hash)=64),
      method text NOT NULL CHECK(method IN ('cash','transfer','credit')), currency jsonb NOT NULL,
      expected numeric NOT NULL CHECK(expected>=0), tendered numeric NOT NULL CHECK(tendered>=0),
      change numeric NOT NULL CHECK(change>=0), received numeric NOT NULL CHECK(received>=0),
      balance numeric NOT NULL CHECK(balance>=0), deferred numeric NOT NULL CHECK(deferred>=0),
      note text NOT NULL CHECK(length(note)<=2000), basis text NOT NULL CHECK(length(basis)=64),
      snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'), recorded_at timestamptz NOT NULL,
      payment_date date NOT NULL, timezone text NOT NULL,
      FOREIGN KEY(execution_id,shipment_id) REFERENCES route_driver_execution_orders(execution_id,shipment_id),
      UNIQUE(execution_id,shipment_id), UNIQUE(device_id,command_id),
      CHECK(received=tendered-change AND expected=received+balance),
      CHECK(method='cash' OR change=0), CHECK(method<>'credit' OR tendered=0),
      CHECK(change=0 OR balance=0)
    );
    CREATE OR REPLACE FUNCTION verify_order_payment() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE actual_driver uuid; actual_status text; actual_device uuid;
    BEGIN
      IF EXISTS(SELECT 1 FROM unnest(ARRAY[NEW.expected,NEW.tendered,NEW.change,NEW.received,NEW.balance,NEW.deferred]) amount
        WHERE amount::text IN ('NaN','Infinity','-Infinity') OR amount<0) THEN
        RAISE EXCEPTION 'PAYMENT_AMOUNT_INVALID' USING ERRCODE='23514';
      END IF;
      SELECT driver_id INTO actual_driver FROM route_driver_executions WHERE id=NEW.execution_id FOR UPDATE;
      SELECT status INTO actual_status FROM route_driver_execution_orders WHERE execution_id=NEW.execution_id AND shipment_id=NEW.shipment_id FOR UPDATE;
      SELECT driver_id INTO actual_device FROM route_driver_mobile_devices WHERE id=NEW.device_id;
      IF actual_driver IS DISTINCT FROM NEW.driver_id OR actual_device IS DISTINCT FROM NEW.driver_id OR actual_status IS DISTINCT FROM 'delivered' THEN
        RAISE EXCEPTION 'PAYMENT_ORDER_INVALID' USING ERRCODE='23514';
      END IF;
      IF jsonb_typeof(NEW.currency) IS DISTINCT FROM 'object' OR NOT (NEW.currency ?& ARRAY['id','name','rounding','decimalPlaces'])
        OR NEW.currency->>'rounding' IS NULL OR NEW.currency->>'rounding' IN ('NaN','Infinity','-Infinity')
        OR (NEW.currency->>'rounding')::numeric<=0
        OR EXISTS(SELECT 1 FROM unnest(ARRAY[NEW.expected,NEW.tendered,NEW.change,NEW.received,NEW.balance,NEW.deferred]) amount
          WHERE mod(amount,(NEW.currency->>'rounding')::numeric)<>0) THEN
        RAISE EXCEPTION 'PAYMENT_CURRENCY_INVALID' USING ERRCODE='23514';
      END IF;
      IF NEW.snapshot->>'shipmentId' IS DISTINCT FROM NEW.shipment_id::text OR NEW.snapshot->>'basis' IS DISTINCT FROM NEW.basis
        OR NEW.snapshot->'financial'->'currency' IS DISTINCT FROM NEW.currency
        OR (NEW.snapshot->'financial'->'totals'->>'net')::numeric IS DISTINCT FROM NEW.expected
        OR (NEW.snapshot->'financial'->'totals'->>'deferred')::numeric IS DISTINCT FROM NEW.deferred THEN
        RAISE EXCEPTION 'PAYMENT_SNAPSHOT_INVALID' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER verify_payment BEFORE INSERT ON route_order_payments FOR EACH ROW EXECUTE FUNCTION verify_order_payment();
    CREATE OR REPLACE TRIGGER immutable_payment BEFORE UPDATE OR DELETE ON route_order_payments FOR EACH ROW EXECUTE FUNCTION preserve_driver_event();
    CREATE INDEX IF NOT EXISTS payment_driver_date ON route_order_payments(driver_id,payment_date);
    CREATE OR REPLACE TRIGGER panel_changed AFTER INSERT ON route_order_payments FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
    UPDATE rutas_installation SET schema_version=36 WHERE singleton=true;
  `);
}
