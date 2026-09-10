import type { Sql } from "./database";
export async function migrateOrders(sql: Sql) {
  await sql.query(`
    CREATE TABLE route_order_source (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), fingerprint text NOT NULL UNIQUE
    );
    CREATE TABLE route_plan_vehicles (
      plan_id uuid NOT NULL REFERENCES route_plans(id), vehicle_id uuid NOT NULL REFERENCES route_vehicles(id),
      driver_id uuid REFERENCES route_drivers(id), PRIMARY KEY(plan_id,vehicle_id), UNIQUE(plan_id,driver_id)
    );
    CREATE TABLE route_shipments (
      id uuid PRIMARY KEY, source text NOT NULL REFERENCES route_order_source(fingerprint),
      picking_id bigint NOT NULL CHECK(picking_id>0), order_id bigint NOT NULL CHECK(order_id>0),
      partner_id bigint NOT NULL CHECK(partner_id>0), plan_id uuid NOT NULL REFERENCES route_plans(id),
      vehicle_id uuid, position integer NOT NULL CHECK(position>0),
      snapshot jsonb NOT NULL, snapshot_hash text NOT NULL,
      window_start time, window_end time, high_priority boolean,
      created_by uuid NOT NULL REFERENCES route_users(id), created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(source,picking_id,order_id),
      UNIQUE(plan_id,position) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY(plan_id,vehicle_id) REFERENCES route_plan_vehicles(plan_id,vehicle_id),
      CHECK((window_start IS NULL AND window_end IS NULL) OR (window_start IS NOT NULL AND window_end IS NOT NULL AND window_start<window_end))
    );
    CREATE INDEX route_shipments_plan ON route_shipments(plan_id,position,id);
    UPDATE rutas_installation SET schema_version=3 WHERE singleton=true;
  `);
}

export async function migrateOrderPlanIdentity(sql: Sql) {
  await sql.query(`
    CREATE UNIQUE INDEX route_shipments_plan_source_picking_order
      ON route_shipments(plan_id,source,picking_id,order_id);
    ALTER TABLE route_shipments
      DROP CONSTRAINT IF EXISTS route_shipments_source_picking_id_order_id_key;
    UPDATE rutas_installation SET schema_version=4 WHERE singleton=true;
  `);
}
