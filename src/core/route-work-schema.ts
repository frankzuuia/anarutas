import type { Sql } from "./database";

export const routeWorkVerificationSql = `
    CREATE OR REPLACE FUNCTION verify_driver_work_completion() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE actual_driver uuid; actual_device uuid;
    BEGIN
      SELECT driver_id INTO actual_driver FROM route_driver_executions WHERE id=NEW.execution_id FOR UPDATE;
      SELECT driver_id INTO actual_device FROM route_driver_mobile_devices WHERE id=NEW.device_id;
      IF actual_driver IS DISTINCT FROM NEW.driver_id OR actual_device IS DISTINCT FROM NEW.driver_id
        OR NOT route_settlement_ready(NEW.execution_id)
        OR NOT EXISTS(SELECT 1 FROM route_order_payments WHERE execution_id=NEW.execution_id)
        OR EXISTS(SELECT 1 FROM route_driver_execution_orders o WHERE o.execution_id=NEW.execution_id AND o.status='delivered'
          AND NOT EXISTS(SELECT 1 FROM route_order_payments p WHERE (p.execution_id,p.shipment_id)=(o.execution_id,o.shipment_id)))
        OR EXISTS(SELECT 1 FROM route_order_payments p LEFT JOIN route_settlement_claims c ON c.payment_id=p.id
          LEFT JOIN route_settlement_requests r ON r.id=c.request_id WHERE p.execution_id=NEW.execution_id AND r.status IS DISTINCT FROM 'accepted')
      THEN RAISE EXCEPTION 'WORK_SETTLEMENT_PENDING' USING ERRCODE='23514'; END IF;
      IF NEW.snapshot->>'contractVersion' IS DISTINCT FROM '1'
        OR jsonb_typeof(NEW.snapshot->'paymentIds') IS DISTINCT FROM 'array'
        OR jsonb_typeof(NEW.snapshot->'totals') IS DISTINCT FROM 'array'
        OR (NEW.snapshot->>'deliveredOrders')::int IS DISTINCT FROM
          (SELECT count(*)::int FROM route_driver_execution_orders WHERE execution_id=NEW.execution_id AND status='delivered')
        OR (NEW.snapshot->>'incidents')::int IS DISTINCT FROM
          (SELECT count(DISTINCT i->>'id')::int FROM route_order_payments p CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'incidents') i
            WHERE p.execution_id=NEW.execution_id AND i->>'status'<>'canceled')
        OR NEW.snapshot->'paymentIds' IS DISTINCT FROM
          (SELECT jsonb_agg(id::text ORDER BY id::text) FROM route_order_payments WHERE execution_id=NEW.execution_id)
        OR jsonb_array_length(NEW.snapshot->'totals') IS DISTINCT FROM
          (SELECT count(DISTINCT (currency->>'id',currency->>'name'))::int FROM route_order_payments WHERE execution_id=NEW.execution_id)
      THEN RAISE EXCEPTION 'WORK_SUMMARY_INVALID' USING ERRCODE='23514'; END IF;
      IF EXISTS(
        WITH expected AS (SELECT currency->>'id' AS currency_id,currency->>'name' AS currency_name,sum(expected) AS total,
          (array_agg(currency ORDER BY recorded_at DESC,id DESC))[1] AS currency
          FROM route_order_payments WHERE execution_id=NEW.execution_id GROUP BY currency->>'id',currency->>'name'),
        actual AS (SELECT value->'currency' AS currency,value->'currency'->>'id' AS currency_id,value->'currency'->>'name' AS currency_name,
          (value->>'total')::numeric AS total FROM jsonb_array_elements(NEW.snapshot->'totals'))
        SELECT 1 FROM expected e FULL JOIN actual a USING(currency_id,currency_name)
          WHERE e.total IS DISTINCT FROM a.total OR e.currency IS DISTINCT FROM a.currency
      ) THEN RAISE EXCEPTION 'WORK_SUMMARY_INVALID' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER verify_driver_work BEFORE INSERT ON route_driver_work_completions
      FOR EACH ROW EXECUTE FUNCTION verify_driver_work_completion();
    CREATE OR REPLACE TRIGGER immutable_driver_work BEFORE UPDATE OR DELETE ON route_driver_work_completions
      FOR EACH ROW EXECUTE FUNCTION preserve_driver_event();
    CREATE OR REPLACE TRIGGER panel_changed AFTER INSERT ON route_driver_work_completions
      FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
`;

export async function migrateRouteWork(sql: Sql) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS route_driver_work_completions (
      execution_id uuid PRIMARY KEY REFERENCES route_driver_executions(id),
      driver_id uuid NOT NULL REFERENCES route_drivers(id),
      device_id uuid NOT NULL REFERENCES route_driver_mobile_devices(id),
      command_id uuid NOT NULL, request_hash text NOT NULL CHECK(length(request_hash)=64),
      completed_at timestamptz NOT NULL,
      snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
      UNIQUE(device_id,command_id)
    );
    CREATE INDEX IF NOT EXISTS driver_work_owner ON route_driver_work_completions(driver_id);
    ${routeWorkVerificationSql}
    UPDATE rutas_installation SET schema_version=40 WHERE singleton=true;
  `);
}
