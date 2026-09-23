import type { Sql } from "./database";

export async function migrateRouteCancellation(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_plan_publications ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='publication_revoked_not_started') THEN
        ALTER TABLE route_plan_publications ADD CONSTRAINT publication_revoked_not_started
          CHECK (revoked_at IS NULL OR started_at IS NULL);
      END IF;
    END $$;
    CREATE OR REPLACE FUNCTION guard_started_publication()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF OLD.started_at IS NOT NULL THEN
        IF TG_OP = 'UPDATE'
           AND current_setting('ana_rutas.cancel_started_route', true) = 'on'
           AND OLD.revoked_at IS NULL
           AND NEW.revoked_at IS NOT NULL
           AND NEW.started_at IS NULL
           AND NEW.started_driver_id IS NULL
           AND NEW.revision = OLD.revision + 1
           AND to_jsonb(NEW) - ARRAY['started_at','started_driver_id','revoked_at','revision']
             = to_jsonb(OLD) - ARRAY['started_at','started_driver_id','revoked_at','revision']
        THEN RETURN NEW;
        END IF;
        PERFORM reject_started_route_change();
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$;
    UPDATE rutas_installation SET schema_version=17 WHERE singleton=true;
  `);
}
