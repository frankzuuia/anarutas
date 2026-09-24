import type { Sql } from "./database";

export async function migrateRoutePush(sql: Sql) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS route_mobile_push_registrations (
      device_id uuid PRIMARY KEY REFERENCES route_driver_mobile_devices(id),
      driver_id uuid NOT NULL REFERENCES route_drivers(id),
      fid text NOT NULL UNIQUE CHECK(length(fid) BETWEEN 16 AND 256),
      updated_at timestamptz NOT NULL DEFAULT now(),
      disabled_at timestamptz,
      FOREIGN KEY(device_id,driver_id)
        REFERENCES route_driver_mobile_devices(id,driver_id)
    );
    CREATE INDEX IF NOT EXISTS route_mobile_push_driver ON route_mobile_push_registrations(driver_id)
      WHERE disabled_at IS NULL;
    CREATE TABLE IF NOT EXISTS route_mobile_push_deliveries (
      id bigserial PRIMARY KEY,
      device_id uuid NOT NULL REFERENCES route_driver_mobile_devices(id),
      driver_id uuid NOT NULL REFERENCES route_drivers(id),
      plan_id uuid NOT NULL,
      vehicle_id uuid NOT NULL,
      revision integer NOT NULL CHECK(revision > 0),
      kind text NOT NULL CHECK(kind IN ('published','withdrawn')),
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT (now()+interval '4 hours'),
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      claimed_until timestamptz,
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      delivered_at timestamptz,
      discarded_at timestamptz,
      last_error text,
      UNIQUE(device_id,plan_id,vehicle_id,revision,kind)
    );
    CREATE INDEX IF NOT EXISTS route_mobile_push_pending ON route_mobile_push_deliveries(next_attempt_at,id)
      WHERE delivered_at IS NULL AND discarded_at IS NULL;
    CREATE INDEX IF NOT EXISTS route_mobile_push_expiry ON route_mobile_push_deliveries(expires_at)
      WHERE delivered_at IS NULL AND discarded_at IS NULL;
    CREATE OR REPLACE FUNCTION queue_route_mobile_push(
      target_driver uuid, target_plan uuid, target_vehicle uuid,
      target_revision integer, target_kind text
    ) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO route_mobile_push_deliveries
        (device_id,driver_id,plan_id,vehicle_id,revision,kind)
      SELECT r.device_id,r.driver_id,target_plan,target_vehicle,target_revision,target_kind
        FROM route_mobile_push_registrations r
        JOIN route_driver_mobile_devices d ON d.id=r.device_id AND d.driver_id=r.driver_id
        JOIN route_driver_mobile_access a ON a.driver_id=r.driver_id
        JOIN route_drivers f ON f.id=r.driver_id
       WHERE r.driver_id=target_driver AND r.disabled_at IS NULL
         AND d.revoked_at IS NULL AND a.enabled AND f.active
      ON CONFLICT DO NOTHING;
    END $$;
    CREATE OR REPLACE FUNCTION route_publication_push_change()
      RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.revoked_at IS NULL THEN
          PERFORM queue_route_mobile_push(NEW.driver_id,NEW.plan_id,NEW.vehicle_id,NEW.revision,'published');
        END IF;
        RETURN NEW;
      END IF;
      IF TG_OP = 'DELETE' THEN
        IF OLD.revoked_at IS NULL THEN
          PERFORM queue_route_mobile_push(OLD.driver_id,OLD.plan_id,OLD.vehicle_id,OLD.revision,'withdrawn');
        END IF;
        RETURN OLD;
      END IF;
      IF OLD.revoked_at IS NULL AND (NEW.revoked_at IS NOT NULL OR NEW.driver_id<>OLD.driver_id) THEN
        PERFORM queue_route_mobile_push(OLD.driver_id,OLD.plan_id,OLD.vehicle_id,NEW.revision,'withdrawn');
      END IF;
      IF NEW.revoked_at IS NULL AND
        (OLD.revoked_at IS NOT NULL OR NEW.driver_id<>OLD.driver_id OR
         NEW.revision<>OLD.revision OR NEW.snapshot_hash<>OLD.snapshot_hash) THEN
        PERFORM queue_route_mobile_push(NEW.driver_id,NEW.plan_id,NEW.vehicle_id,NEW.revision,'published');
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE TRIGGER route_publication_push
      AFTER INSERT OR UPDATE OR DELETE ON route_plan_publications
      FOR EACH ROW EXECUTE FUNCTION route_publication_push_change();
    UPDATE rutas_installation SET schema_version=19 WHERE singleton=true;
  `);
}
