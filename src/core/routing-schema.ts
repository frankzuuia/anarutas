import type { Sql } from "./database";

export async function migrateRouting(sql: Sql) {
  await sql.query(`
    CREATE TABLE route_routing_settings (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      depot_address text NOT NULL CHECK(char_length(depot_address) BETWEEN 1 AND 500),
      depot_latitude double precision NOT NULL CHECK(depot_latitude BETWEEN -90 AND 90),
      depot_longitude double precision NOT NULL CHECK(depot_longitude BETWEEN -180 AND 180),
      depot_place_id text CHECK(depot_place_id IS NULL OR char_length(depot_place_id) BETWEEN 1 AND 300),
      version integer NOT NULL DEFAULT 1 CHECK(version > 0),
      updated_by uuid NOT NULL REFERENCES route_users(id),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE route_optimization_runs (
      id uuid PRIMARY KEY,
      plan_id uuid NOT NULL REFERENCES route_plans(id) ON DELETE CASCADE,
      base_plan_version integer NOT NULL CHECK(base_plan_version > 0),
      applied_plan_version integer NOT NULL CHECK(applied_plan_version > base_plan_version),
      request_hash text NOT NULL CHECK(char_length(request_hash)=64),
      metrics jsonb NOT NULL,
      routes jsonb NOT NULL,
      skipped jsonb NOT NULL,
      created_by uuid NOT NULL REFERENCES route_users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(plan_id,base_plan_version,request_hash)
    );
    CREATE INDEX route_optimization_runs_plan
      ON route_optimization_runs(plan_id,applied_plan_version DESC,created_at DESC);
    CREATE TABLE route_optimization_leases (
      plan_id uuid PRIMARY KEY REFERENCES route_plans(id) ON DELETE CASCADE,
      token uuid NOT NULL,
      base_plan_version integer NOT NULL CHECK(base_plan_version > 0),
      request_hash text NOT NULL CHECK(char_length(request_hash)=64),
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE route_optimization_stops (
      run_id uuid NOT NULL REFERENCES route_optimization_runs(id) ON DELETE CASCADE,
      shipment_id uuid NOT NULL,
      vehicle_id uuid NOT NULL,
      position integer NOT NULL CHECK(position > 0),
      eta timestamptz NOT NULL,
      travel_distance_meters integer NOT NULL CHECK(travel_distance_meters >= 0),
      travel_duration_seconds integer NOT NULL CHECK(travel_duration_seconds >= 0),
      wait_duration_seconds integer NOT NULL CHECK(wait_duration_seconds >= 0),
      PRIMARY KEY(run_id,shipment_id),
      UNIQUE(run_id,vehicle_id,position)
    );
    UPDATE rutas_installation SET schema_version=6 WHERE singleton=true;
  `);
}
