import type { Sql } from "./database";

export async function migrateOdooReturns(sql: Sql) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS route_odoo_return_activation (
      source text PRIMARY KEY, enabled_since timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS route_odoo_return_capture (
      incident_id uuid PRIMARY KEY REFERENCES route_product_incidents(id), source text NOT NULL,
      captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS route_odoo_return_jobs (
      id uuid PRIMARY KEY,
      execution_id uuid NOT NULL,
      shipment_id uuid NOT NULL,
      payment_id uuid NOT NULL UNIQUE REFERENCES route_order_payments(id),
      source text NOT NULL,
      picking_id bigint NOT NULL CHECK(picking_id>0),
      order_id bigint NOT NULL CHECK(order_id>0),
      request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
      status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','uncertain','prepared','review')),
      creation_started boolean NOT NULL DEFAULT false,
      remote_id bigint CHECK(remote_id>0),
      receipt jsonb,
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
      last_error text,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      last_duration_ms integer CHECK(last_duration_ms>=0),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(execution_id,shipment_id) REFERENCES route_driver_execution_orders(execution_id,shipment_id),
      UNIQUE(execution_id,shipment_id),
      CHECK(status<>'prepared' OR (remote_id IS NOT NULL AND receipt IS NOT NULL)),
      CHECK(remote_id IS NULL OR creation_started)
    );
    CREATE TABLE IF NOT EXISTS route_odoo_return_incidents (
      incident_id uuid PRIMARY KEY REFERENCES route_product_incidents(id),
      job_id uuid NOT NULL REFERENCES route_odoo_return_jobs(id)
    );
    CREATE TABLE IF NOT EXISTS route_odoo_return_attempts (
      id bigserial PRIMARY KEY, job_id uuid NOT NULL REFERENCES route_odoo_return_jobs(id),
      status text NOT NULL, error_code text, duration_ms integer NOT NULL CHECK(duration_ms>=0),
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX IF NOT EXISTS route_odoo_return_due ON route_odoo_return_jobs(next_attempt_at,id) WHERE status IN ('queued','sending','uncertain');
    CREATE OR REPLACE TRIGGER panel_changed AFTER INSERT OR UPDATE ON route_odoo_return_jobs FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
    CREATE OR REPLACE FUNCTION validate_odoo_return_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM route_order_payments p JOIN route_shipments s ON s.id=p.shipment_id
        WHERE p.id=NEW.payment_id AND p.execution_id=NEW.execution_id AND p.shipment_id=NEW.shipment_id
          AND s.source=NEW.source AND s.picking_id=NEW.picking_id AND s.order_id=NEW.order_id
          AND NEW.request->>'id'=NEW.id::text AND NEW.request->>'source'=NEW.source
          AND NEW.request->>'pickingId'=NEW.picking_id::text AND NEW.request->>'orderId'=NEW.order_id::text
          AND NEW.request->>'partnerId'=s.partner_id::text
      ) THEN RAISE EXCEPTION 'ODOO_RETURN_IDENTITY_INVALID' USING ERRCODE='42501'; END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER validate_odoo_return_job BEFORE INSERT ON route_odoo_return_jobs FOR EACH ROW EXECUTE FUNCTION validate_odoo_return_identity();
    CREATE OR REPLACE FUNCTION validate_odoo_return_incident() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM route_odoo_return_jobs j JOIN route_product_incidents i
          ON i.execution_id=j.execution_id AND i.shipment_id=j.shipment_id
        JOIN route_odoo_return_capture c ON c.incident_id=i.id AND c.source=j.source
        WHERE j.id=NEW.job_id AND i.id=NEW.incident_id AND i.kind='return' AND i.status<>'canceled'
      ) THEN RAISE EXCEPTION 'ODOO_RETURN_INCIDENT_INVALID' USING ERRCODE='42501'; END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER validate_odoo_return_link BEFORE INSERT OR UPDATE ON route_odoo_return_incidents FOR EACH ROW EXECUTE FUNCTION validate_odoo_return_incident();
    CREATE OR REPLACE FUNCTION preserve_odoo_return_request() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','creation_started','remote_id','receipt','attempts','last_error','next_attempt_at','last_duration_ms','updated_at']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['status','creation_started','remote_id','receipt','attempts','last_error','next_attempt_at','last_duration_ms','updated_at']) THEN
        RAISE EXCEPTION 'ODOO_RETURN_REQUEST_IMMUTABLE' USING ERRCODE='42501';
      END IF;
      IF OLD.creation_started AND NOT NEW.creation_started OR OLD.remote_id IS NOT NULL AND NEW.remote_id IS DISTINCT FROM OLD.remote_id THEN
        RAISE EXCEPTION 'ODOO_RETURN_IDENTITY_IMMUTABLE' USING ERRCODE='42501';
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER preserve_odoo_return_job BEFORE UPDATE OR DELETE ON route_odoo_return_jobs FOR EACH ROW EXECUTE FUNCTION preserve_odoo_return_request();
    UPDATE rutas_installation SET schema_version=48 WHERE singleton=true;
  `);
}
