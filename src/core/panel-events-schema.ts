import type { Sql } from "./database";

export async function migratePanelEvents(sql: Sql) {
  await sql.query(`
    CREATE OR REPLACE FUNCTION notify_panel_change() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_notify('ana_rutas_panel', 'changed');
      RETURN NULL;
    END $$;
    DO $$ DECLARE target text; BEGIN
      FOREACH target IN ARRAY ARRAY[
        'route_plans','route_plan_vehicles','route_shipments',
        'route_plan_publications','route_unit_photos',
        'route_vehicles','route_drivers','route_driver_documents',
        'route_customers','route_customer_windows','route_routing_settings',
        'route_optimization_runs','route_google_consumption_state',
        'route_users','route_audit','route_driver_mobile_audit'
      ] LOOP
        EXECUTE format('CREATE OR REPLACE TRIGGER panel_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change()', target);
      END LOOP;
    END $$;
    UPDATE rutas_installation SET schema_version=18 WHERE singleton=true;
  `);
}
