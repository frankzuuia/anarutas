import type { Sql } from "./database";

export async function migrateOrderCandidates(sql: Sql) {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS route_order_batches (
      id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES route_users(id),
      plan_id uuid NOT NULL REFERENCES route_plans(id) ON DELETE CASCADE,
      source text NOT NULL, service_date date NOT NULL, plan_version integer NOT NULL,
      vehicle_ids uuid[] NOT NULL, candidates jsonb NOT NULL CHECK(jsonb_typeof(candidates)='array'),
      query_hash text NOT NULL, query_range jsonb NOT NULL, expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), consumed_at timestamptz,
      confirmation_hash text, receipt jsonb,
      CHECK ((consumed_at IS NULL AND confirmation_hash IS NULL AND receipt IS NULL)
        OR (consumed_at IS NOT NULL AND confirmation_hash IS NOT NULL AND receipt IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS route_order_batches_expiry ON route_order_batches(expires_at);
    CREATE INDEX IF NOT EXISTS route_order_batches_plan ON route_order_batches(plan_id);
    UPDATE route_shipments SET snapshot=snapshot || '{"odooPickingState":"done","fulfillmentStatus":"validated"}'::jsonb
      WHERE NOT(snapshot ? 'fulfillmentStatus');
    UPDATE rutas_installation SET schema_version=9 WHERE singleton=true;
  `);
}
