import type { Sql } from "./database";

export async function migrateRouteFleetReassignment(sql: Sql) {
  await sql.query(`
    CREATE OR REPLACE FUNCTION guard_started_fleet_vehicle()
    RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF OLD.available IS DISTINCT FROM NEW.available AND EXISTS (
        SELECT 1 FROM route_plan_publications p
         WHERE p.vehicle_id=OLD.id AND p.started_at IS NOT NULL
      ) THEN
        PERFORM reject_started_route_change();
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS guard_started_fleet_vehicle_change ON route_vehicles;
    CREATE TRIGGER guard_started_fleet_vehicle_change
      BEFORE UPDATE OF available ON route_vehicles
      FOR EACH ROW EXECUTE FUNCTION guard_started_fleet_vehicle();
    UPDATE rutas_installation SET schema_version=15 WHERE singleton=true;
  `);
}
