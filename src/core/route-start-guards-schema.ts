import type { Sql } from "./database";

export async function migrateRouteStartGuards(sql: Sql) {
  await sql.query(`
    CREATE OR REPLACE FUNCTION reject_started_route_change()
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'ROUTE_ALREADY_STARTED' USING ERRCODE='PZR01';
    END $$;

    CREATE OR REPLACE FUNCTION guard_started_publication()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF OLD.started_at IS NOT NULL THEN
        PERFORM reject_started_route_change();
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS guard_started_publication_change ON route_plan_publications;
    CREATE TRIGGER guard_started_publication_change
      BEFORE UPDATE OR DELETE ON route_plan_publications
      FOR EACH ROW EXECUTE FUNCTION guard_started_publication();

    CREATE OR REPLACE FUNCTION guard_started_shipment()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP <> 'INSERT' AND OLD.vehicle_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM route_plan_publications p
         WHERE p.plan_id=OLD.plan_id AND p.vehicle_id=OLD.vehicle_id
           AND p.started_at IS NOT NULL
      ) THEN
        PERFORM reject_started_route_change();
      END IF;
      IF TG_OP <> 'DELETE' AND NEW.vehicle_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM route_plan_publications p
         WHERE p.plan_id=NEW.plan_id AND p.vehicle_id=NEW.vehicle_id
           AND p.started_at IS NOT NULL
      ) THEN
        PERFORM reject_started_route_change();
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS guard_started_shipment_change ON route_shipments;
    CREATE TRIGGER guard_started_shipment_change
      BEFORE INSERT OR UPDATE OR DELETE ON route_shipments
      FOR EACH ROW EXECUTE FUNCTION guard_started_shipment();

    CREATE OR REPLACE FUNCTION guard_started_plan_vehicle()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM route_plan_publications p
         WHERE p.plan_id=OLD.plan_id AND p.vehicle_id=OLD.vehicle_id
           AND p.started_at IS NOT NULL
      ) THEN
        PERFORM reject_started_route_change();
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS guard_started_plan_vehicle_change ON route_plan_vehicles;
    CREATE TRIGGER guard_started_plan_vehicle_change
      BEFORE UPDATE OR DELETE ON route_plan_vehicles
      FOR EACH ROW EXECUTE FUNCTION guard_started_plan_vehicle();

    CREATE OR REPLACE FUNCTION guard_started_fleet_vehicle()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF (OLD.available IS DISTINCT FROM NEW.available
          OR OLD.driver_id IS DISTINCT FROM NEW.driver_id) AND EXISTS (
        SELECT 1 FROM route_plan_publications p
         WHERE p.vehicle_id=OLD.id AND p.started_at IS NOT NULL
      ) THEN
        PERFORM reject_started_route_change();
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS guard_started_fleet_vehicle_change ON route_vehicles;
    CREATE TRIGGER guard_started_fleet_vehicle_change
      BEFORE UPDATE OF available,driver_id ON route_vehicles
      FOR EACH ROW EXECUTE FUNCTION guard_started_fleet_vehicle();

    UPDATE rutas_installation SET schema_version=13 WHERE singleton=true;
  `);
}
