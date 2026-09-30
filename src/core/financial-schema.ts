import type { Sql } from "./database";

export async function migrateFinancialSources(sql: Sql) {
  await sql.query(`
    -- Independent of plans/publications: retiring an operational route cannot erase history.
    CREATE TABLE IF NOT EXISTS route_financial_targets (
      source text NOT NULL, picking_id bigint NOT NULL CHECK(picking_id>0),
      order_id bigint NOT NULL CHECK(order_id>0), partner_id bigint NOT NULL CHECK(partner_id>0),
      revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), content_hash text,
      next_attempt_at timestamptz NOT NULL DEFAULT now(), last_checked_at timestamptz,
      last_success_at timestamptz, last_error text, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
      failures integer NOT NULL DEFAULT 0 CHECK(failures>=0), last_duration_ms integer CHECK(last_duration_ms>=0),
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(source,picking_id,order_id),
      CHECK((revision=0 AND content_hash IS NULL) OR (revision>0 AND content_hash IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS route_financial_due ON route_financial_targets(source,next_attempt_at);
    CREATE TABLE IF NOT EXISTS route_financial_revisions (
      source text NOT NULL, picking_id bigint NOT NULL, order_id bigint NOT NULL,
      revision integer NOT NULL CHECK(revision>0), content_hash text NOT NULL,
      snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'), observed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(source,picking_id,order_id,revision),
      FOREIGN KEY(source,picking_id,order_id) REFERENCES route_financial_targets(source,picking_id,order_id),
      CHECK((snapshot->>'contractVersion'='1') IS TRUE),
      CHECK((snapshot->'target'->>'source'=source) IS TRUE),
      CHECK(((snapshot->'target'->>'pickingId')::bigint=picking_id) IS TRUE),
      CHECK(((snapshot->'target'->>'orderId')::bigint=order_id) IS TRUE)
    );
    CREATE TABLE IF NOT EXISTS route_financial_sync_state (
      source text PRIMARY KEY, next_attempt_at timestamptz NOT NULL DEFAULT now(),
      failures integer NOT NULL DEFAULT 0 CHECK(failures>=0), last_error text,
      last_checked_at timestamptz, last_success_at timestamptz,
      last_duration_ms integer CHECK(last_duration_ms>=0), attempts bigint NOT NULL DEFAULT 0,
      errors bigint NOT NULL DEFAULT 0, rate_limits bigint NOT NULL DEFAULT 0
    );
    CREATE OR REPLACE FUNCTION preserve_financial_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'FINANCIAL_REVISION_IMMUTABLE' USING ERRCODE='42501';
    END $$;
    CREATE OR REPLACE TRIGGER immutable_financial_revision BEFORE UPDATE OR DELETE ON route_financial_revisions
      FOR EACH ROW EXECUTE FUNCTION preserve_financial_revision();
    CREATE OR REPLACE FUNCTION track_shipment_financial_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO route_financial_targets(source,picking_id,order_id,partner_id)
        VALUES(NEW.source,NEW.picking_id,NEW.order_id,NEW.partner_id)
        ON CONFLICT(source,picking_id,order_id) DO NOTHING;
      IF NOT EXISTS(SELECT 1 FROM route_financial_targets WHERE source=NEW.source AND picking_id=NEW.picking_id
          AND order_id=NEW.order_id AND partner_id=NEW.partner_id) THEN
        RAISE EXCEPTION 'FINANCIAL_IDENTITY_CHANGED' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER track_shipment_finance AFTER INSERT ON route_shipments
      FOR EACH ROW EXECUTE FUNCTION track_shipment_financial_source();
    INSERT INTO route_financial_targets(source,picking_id,order_id,partner_id)
      SELECT DISTINCT source,picking_id,order_id,partner_id FROM route_shipments
      ON CONFLICT(source,picking_id,order_id) DO NOTHING;
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM route_shipments s JOIN route_financial_targets t
        ON (t.source,t.picking_id,t.order_id)=(s.source,s.picking_id,s.order_id) WHERE t.partner_id<>s.partner_id) THEN
        RAISE EXCEPTION 'FINANCIAL_IDENTITY_CHANGED' USING ERRCODE='23514';
      END IF;
    END $$;
    UPDATE rutas_installation SET schema_version=34 WHERE singleton=true;
  `);
}
