import type { Sql } from "./database";

export async function migrateRoutePublicationRevisions(sql: Sql) {
  await sql.query(`
    -- Deliberately survives removal of plan membership/publication/history.
    CREATE TABLE IF NOT EXISTS route_publication_revisions (
      plan_id uuid NOT NULL, vehicle_id uuid NOT NULL,
      last_revision integer NOT NULL CHECK(last_revision>0),
      PRIMARY KEY(plan_id,vehicle_id)
    );
    INSERT INTO route_publication_revisions(plan_id,vehicle_id,last_revision)
    SELECT plan_id,vehicle_id,max(revision) FROM (
      SELECT plan_id,vehicle_id,revision FROM route_plan_publications
      UNION ALL
      SELECT plan_id,vehicle_id,publication_revision FROM route_driver_executions
      UNION ALL
      SELECT a.entity_id::uuid,(change->>'vehicleId')::uuid,(change->>'revision')::integer
        FROM route_audit a CROSS JOIN LATERAL jsonb_array_elements(a.details->'changes') change
       WHERE a.action='route.publication.changed'
      UNION ALL
      SELECT entity_id::uuid,(details->>'vehicleId')::uuid,(details->>'revision')::integer
        FROM route_audit WHERE action IN ('route.start.cancelled','route.publication.cancelled')
    ) history WHERE plan_id IS NOT NULL AND vehicle_id IS NOT NULL AND revision>0
    GROUP BY plan_id,vehicle_id
    ON CONFLICT(plan_id,vehicle_id) DO UPDATE SET
      last_revision=GREATEST(route_publication_revisions.last_revision,EXCLUDED.last_revision);

    CREATE OR REPLACE FUNCTION retain_route_publication_revision()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE target_plan uuid; target_vehicle uuid; target_revision integer;
    BEGIN
      IF TG_OP='DELETE' THEN
        target_plan:=OLD.plan_id; target_vehicle:=OLD.vehicle_id; target_revision:=OLD.revision;
      ELSE
        target_plan:=NEW.plan_id; target_vehicle:=NEW.vehicle_id; target_revision:=NEW.revision;
      END IF;
      INSERT INTO route_publication_revisions(plan_id,vehicle_id,last_revision)
        VALUES(target_plan,target_vehicle,target_revision)
      ON CONFLICT(plan_id,vehicle_id) DO UPDATE SET last_revision=EXCLUDED.last_revision
        WHERE route_publication_revisions.last_revision<EXCLUDED.last_revision;
      RETURN NULL;
    END $$;
    CREATE OR REPLACE TRIGGER retain_route_publication_revision
      AFTER INSERT OR UPDATE OR DELETE ON route_plan_publications
      FOR EACH ROW EXECUTE FUNCTION retain_route_publication_revision();
    UPDATE rutas_installation SET schema_version=31 WHERE singleton=true;
  `);
}
