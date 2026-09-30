import type { Sql } from "./database";
export async function migrateSettlements(sql: Sql) {
  await sql.query(`
  CREATE TABLE IF NOT EXISTS route_settlement_requests (
    id uuid PRIMARY KEY,execution_id uuid NOT NULL REFERENCES route_driver_executions(id),driver_id uuid NOT NULL REFERENCES route_drivers(id),
    device_id uuid NOT NULL REFERENCES route_driver_mobile_devices(id),command_id uuid NOT NULL,request_hash text NOT NULL CHECK(length(request_hash)=64),
    scope text NOT NULL CHECK(scope IN ('order','route')),snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
    requested_at timestamptz NOT NULL,decided_at timestamptz,decided_by uuid REFERENCES route_users(id),decision_note text,
    decision_command uuid,decision_hash text CHECK(length(decision_hash)=64), UNIQUE(device_id,command_id),UNIQUE(decided_by,decision_command),
    CHECK(length(decision_note)<=2000),
    CHECK((status='pending' AND version=1 AND num_nonnulls(decided_at,decided_by,decision_note,decision_command,decision_hash)=0)
      OR (status<>'pending' AND version=2 AND num_nonnulls(decided_at,decided_by,decision_note,decision_command,decision_hash)=5))
  );
  CREATE TABLE IF NOT EXISTS route_settlement_items (
    request_id uuid NOT NULL REFERENCES route_settlement_requests(id),payment_id uuid NOT NULL REFERENCES route_order_payments(id),
    PRIMARY KEY(request_id,payment_id)
  );
  CREATE TABLE IF NOT EXISTS route_settlement_claims (
    payment_id uuid PRIMARY KEY REFERENCES route_order_payments(id),request_id uuid NOT NULL REFERENCES route_settlement_requests(id),
    FOREIGN KEY(request_id,payment_id) REFERENCES route_settlement_items(request_id,payment_id)
  );
  CREATE INDEX IF NOT EXISTS settlement_execution ON route_settlement_requests(execution_id,requested_at);
  CREATE INDEX IF NOT EXISTS settlement_driver ON route_settlement_requests(driver_id,requested_at);
  CREATE OR REPLACE FUNCTION verify_settlement_request() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE actual_driver uuid; actual_device uuid;
  BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SETTLEMENT_IMMUTABLE' USING ERRCODE='42501'; END IF;
    IF TG_OP='INSERT' THEN
      IF jsonb_typeof(NEW.snapshot->'paymentIds') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.snapshot->'totals') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'SETTLEMENT_SNAPSHOT_INVALID' USING ERRCODE='23514'; END IF;
      SELECT driver_id INTO actual_driver FROM route_driver_executions WHERE id=NEW.execution_id FOR UPDATE;
      SELECT driver_id INTO actual_device FROM route_driver_mobile_devices WHERE id=NEW.device_id;
      IF actual_driver IS DISTINCT FROM NEW.driver_id OR actual_device IS DISTINCT FROM NEW.driver_id
        OR NOT EXISTS(SELECT 1 FROM route_driver_execution_completions WHERE execution_id=NEW.execution_id)
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
  CREATE OR REPLACE TRIGGER verify_settlement BEFORE INSERT OR UPDATE OR DELETE ON route_settlement_requests FOR EACH ROW EXECUTE FUNCTION verify_settlement_request();
  CREATE OR REPLACE FUNCTION verify_settlement_item() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'SETTLEMENT_ITEM_IMMUTABLE' USING ERRCODE='42501'; END IF;
    IF NOT EXISTS(SELECT 1 FROM route_order_payments p JOIN route_settlement_requests r ON r.execution_id=p.execution_id AND r.driver_id=p.driver_id
      WHERE p.id=NEW.payment_id AND r.id=NEW.request_id AND r.status='pending' AND r.snapshot->'paymentIds' ? NEW.payment_id::text)
      THEN RAISE EXCEPTION 'SETTLEMENT_ITEM_INVALID' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END $$;
  CREATE OR REPLACE TRIGGER verify_settlement_item BEFORE INSERT OR UPDATE OR DELETE ON route_settlement_items FOR EACH ROW EXECUTE FUNCTION verify_settlement_item();
  CREATE OR REPLACE FUNCTION verify_settlement_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'SETTLEMENT_CLAIM_IMMUTABLE' USING ERRCODE='42501'; END IF;
    IF TG_OP='DELETE' THEN
      IF NOT EXISTS(SELECT 1 FROM route_settlement_requests WHERE id=OLD.request_id AND status='rejected') THEN
        RAISE EXCEPTION 'SETTLEMENT_CLAIM_IMMUTABLE' USING ERRCODE='42501'; END IF; RETURN OLD;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM route_settlement_requests WHERE id=NEW.request_id AND status='pending') THEN
      RAISE EXCEPTION 'SETTLEMENT_CLAIM_INVALID' USING ERRCODE='23514'; END IF; RETURN NEW;
  END $$;
  CREATE OR REPLACE TRIGGER verify_settlement_claim BEFORE INSERT OR UPDATE OR DELETE ON route_settlement_claims FOR EACH ROW EXECUTE FUNCTION verify_settlement_claim();
  CREATE OR REPLACE TRIGGER panel_changed AFTER INSERT OR UPDATE ON route_settlement_requests FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
  UPDATE rutas_installation SET schema_version=38 WHERE singleton=true;
 `);
}
