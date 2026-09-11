import type { Sql } from "./database";

export async function migrateRoutingOperations(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_plans ADD COLUMN IF NOT EXISTS departure_minute integer
      CHECK (departure_minute BETWEEN 0 AND 1439);
    ALTER TABLE route_optimization_runs ADD COLUMN IF NOT EXISTS input_fingerprint text;
    ALTER TABLE route_optimization_runs DROP CONSTRAINT IF EXISTS route_optimization_runs_check;
    ALTER TABLE route_optimization_runs ADD CONSTRAINT route_optimization_runs_check
      CHECK(applied_plan_version >= base_plan_version);
    CREATE TABLE IF NOT EXISTS route_recalculation_jobs (
      plan_id uuid PRIMARY KEY REFERENCES route_plans(id) ON DELETE CASCADE,
      revision bigint NOT NULL DEFAULT 1,
      actor_id uuid NOT NULL REFERENCES route_users(id),
      status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','failed')),
      token uuid, attempts integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
      error_code text, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION queue_route_recalculation(target uuid, actor uuid)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS(SELECT 1 FROM route_optimization_runs WHERE plan_id=target) THEN
        INSERT INTO route_recalculation_jobs(plan_id,actor_id,available_at)
          SELECT target,COALESCE(actor,updated_by),now()+interval '1 second'
          FROM route_plans WHERE id=target
        ON CONFLICT(plan_id) DO UPDATE SET revision=route_recalculation_jobs.revision+1,
          actor_id=EXCLUDED.actor_id,status='pending',token=NULL,attempts=0,
          available_at=EXCLUDED.available_at,lease_until=NULL,error_code=NULL,updated_at=now();
      END IF;
    END $$;
    CREATE OR REPLACE FUNCTION route_plan_recalculation_changed()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      PERFORM queue_route_recalculation(NEW.id,NEW.updated_by);
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS route_plan_recalculation ON route_plans;
    CREATE TRIGGER route_plan_recalculation AFTER UPDATE OF version ON route_plans
      FOR EACH ROW WHEN (NEW.version IS DISTINCT FROM OLD.version)
      EXECUTE FUNCTION route_plan_recalculation_changed();
    CREATE OR REPLACE FUNCTION route_settings_recalculation_changed()
    RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p record; BEGIN
      FOR p IN SELECT id FROM route_plans ORDER BY id LOOP
        PERFORM queue_route_recalculation(p.id,NEW.updated_by);
      END LOOP;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS route_settings_recalculation ON route_routing_settings;
    CREATE TRIGGER route_settings_recalculation AFTER UPDATE ON route_routing_settings
      FOR EACH ROW EXECUTE FUNCTION route_settings_recalculation_changed();
    CREATE OR REPLACE FUNCTION route_customer_recalculation_changed()
    RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE p record; BEGIN
      FOR p IN SELECT DISTINCT plan_id FROM route_shipments
        WHERE source=NEW.source AND partner_id=NEW.odoo_partner_id ORDER BY plan_id LOOP
        PERFORM queue_route_recalculation(p.plan_id,NEW.updated_by);
      END LOOP;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS route_customer_recalculation ON route_customers;
    CREATE TRIGGER route_customer_recalculation AFTER UPDATE OF version ON route_customers
      FOR EACH ROW EXECUTE FUNCTION route_customer_recalculation_changed();
    SELECT queue_route_recalculation(p.id,p.updated_by) FROM route_plans p
      WHERE EXISTS(SELECT 1 FROM route_optimization_runs r WHERE r.plan_id=p.id AND r.input_fingerprint IS NULL);
    UPDATE rutas_installation SET schema_version=7 WHERE singleton=true;
  `);
}
