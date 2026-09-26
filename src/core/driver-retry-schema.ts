import type { Sql } from "./database";

// Only extend event vocabularies. Historical rows and immutable triggers stay intact.
export async function migrateDriverRetry(sql: Sql) {
  await sql.query(`
    ALTER TABLE route_driver_stop_events
      DROP CONSTRAINT route_driver_stop_events_kind_check;
    ALTER TABLE route_driver_stop_events ADD CONSTRAINT route_driver_stop_events_kind_check
      CHECK(kind IN ('arrival','repoint','visit_exit','delivery','rejection','reschedule','customer_closed','order_reopened'));
    ALTER TABLE route_driver_incident_events
      DROP CONSTRAINT route_driver_incident_events_kind_check;
    ALTER TABLE route_driver_incident_events ADD CONSTRAINT route_driver_incident_events_kind_check
      CHECK(kind IN ('opened','retry_arrived','retry_abandoned','completed','handled','resolved_by_admin','evidence_expired','reopened'));
    UPDATE rutas_installation SET schema_version=23 WHERE singleton=true;
  `);
}
