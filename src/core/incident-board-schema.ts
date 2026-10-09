import type { Sql } from "./database";
import { liveCaseSource } from "./driver-live-incidents";

export async function migrateIncidentBoard(sql: Sql) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS route_incident_alert_settings (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      seconds integer NOT NULL DEFAULT 5 CHECK(seconds IN (5,10,15)),
      version integer NOT NULL DEFAULT 1 CHECK(version>0)
    );
    INSERT INTO route_incident_alert_settings(singleton) VALUES(true) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS route_incident_notifications (
      sequence bigserial PRIMARY KEY,
      product_id uuid UNIQUE REFERENCES route_product_incidents(id),
      service_id uuid UNIQUE REFERENCES route_driver_service_incidents(id),
      stop_event_id uuid UNIQUE REFERENCES route_driver_stop_events(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      seen_by uuid REFERENCES route_users(id), seen_name text, seen_at timestamptz,
      CHECK(num_nonnulls(product_id,service_id,stop_event_id)=1),
      CHECK((seen_by IS NULL AND seen_name IS NULL AND seen_at IS NULL) OR
        (seen_by IS NOT NULL AND seen_name IS NOT NULL AND seen_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS incident_notifications_unseen ON route_incident_notifications(sequence) WHERE seen_at IS NULL;
    CREATE OR REPLACE FUNCTION capture_incident_notification() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_TABLE_NAME='route_driver_stop_events' THEN
        IF NEW.incident_kind IS DISTINCT FROM 'late_arrival' THEN RETURN NULL; END IF;
      END IF;
      -- Writers already hold their execution lock. Allocate only AFTER this lock,
      -- retained until commit: a visible high sequence cannot skip a lower commit.
      PERFORM pg_advisory_xact_lock(hashtext('ana-rutas:incident-notification-order'));
      IF TG_TABLE_NAME='route_product_incidents' THEN
        INSERT INTO route_incident_notifications(product_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
      ELSIF TG_TABLE_NAME='route_driver_service_incidents' THEN
        INSERT INTO route_incident_notifications(service_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
      ELSE
        INSERT INTO route_incident_notifications(stop_event_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
      END IF;
      RETURN NULL;
    END $$;
    CREATE OR REPLACE TRIGGER incident_notification_created AFTER INSERT ON route_product_incidents
      FOR EACH ROW EXECUTE FUNCTION capture_incident_notification();
    CREATE OR REPLACE TRIGGER incident_notification_created AFTER INSERT ON route_driver_service_incidents
      FOR EACH ROW EXECUTE FUNCTION capture_incident_notification();
    CREATE OR REPLACE TRIGGER incident_notification_created AFTER INSERT ON route_driver_stop_events
      FOR EACH ROW EXECUTE FUNCTION capture_incident_notification();
    CREATE OR REPLACE TRIGGER panel_changed AFTER INSERT OR UPDATE ON route_incident_notifications
      FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();
    CREATE OR REPLACE TRIGGER panel_changed AFTER UPDATE ON route_incident_alert_settings
      FOR EACH STATEMENT EXECUTE FUNCTION notify_panel_change();

    CREATE OR REPLACE VIEW route_incident_live_entries AS
    SELECT 'product'::text AS source,i.id,i.kind,i.driver_id,i.occurred_at,i.event_date,i.timezone,i.status,i.version,
      jsonb_build_object('driver',i.snapshot->>'driver','customer',i.snapshot->>'customer',
        'vehicle',i.snapshot->>'vehicle','plate',i.snapshot->>'plate','address',i.snapshot->>'address',
        'planLabel',i.snapshot->>'planLabel','orders',jsonb_build_array(i.order_name),
        'note',COALESCE(a.comment,i.note),'product',i.product,'quantity',i.quantity::text,'unit',i.unit,
        'warehouseReason',i.warehouse_reason,'resolutionNote',i.resolution_note,
        'photos',COALESCE((SELECT jsonb_agg(p.evidence_id ORDER BY p.position) FROM route_product_incident_photos p WHERE p.incident_id=i.id),'[]'::jsonb)
          || CASE WHEN i.evidence_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(i.evidence_id) END,
        'canResolve',i.kind IN ('replacement_quality','replacement_wrong_product') AND i.status='pending') AS detail
    FROM route_product_incidents i LEFT JOIN route_product_incident_annotations a ON a.incident_id=i.id
    WHERE i.status='pending' AND i.report_removed_at IS NULL
    UNION ALL
    SELECT 'service',i.id,i.kind,i.driver_id,i.occurred_at,i.event_date,i.timezone,i.status,i.version,
      i.snapshot || jsonb_build_object('note',i.note,'reasonCode',i.reason_code,
        'orders',COALESCE((SELECT jsonb_agg(s.order_names[array_position(s.shipment_ids,io.shipment_id)] ORDER BY array_position(s.shipment_ids,io.shipment_id))
          FROM route_driver_incident_orders io WHERE io.incident_id=i.id),'[]'::jsonb),
        'photos',COALESCE((SELECT jsonb_agg(e.id) FROM route_driver_incident_evidence e WHERE e.id=i.evidence_id
          AND e.expires_at>now() AND e.revoked_at IS NULL AND e.removed_at IS NULL),'[]'::jsonb),
        'canResolve',i.status='active' AND i.kind<>'customer_closed')
    ${liveCaseSource()}
    UNION ALL
    SELECT 'stop',i.id,i.incident_kind,i.driver_id,i.occurred_at,i.event_date,i.timezone,'recorded',1,
      (i.details - 'sample' - 'policy' - 'customerBefore') || jsonb_build_object('photos','[]'::jsonb,'canResolve',false)
    FROM route_driver_stop_events i WHERE i.incident_kind IS NOT NULL;
    UPDATE rutas_installation SET schema_version=47 WHERE singleton=true;
  `);
}
