import pg, { type Pool, type PoolClient } from "pg";
import { readConfig } from "./config";
import { AppError } from "./errors";
import { migrateFleet } from "./fleet-schema";
import { migrateOrders } from "./orders-schema";
export type Sql = Pick<PoolClient, "query">;
export function createPool(connectionString: string) {
  return new pg.Pool({
    connectionString,
    max: 6,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    application_name: "ana-rutas",
  });
}
const state = globalThis as typeof globalThis & {
  rutasPool?: Pool;
  rutasPoolKey?: string;
};
export function getPool() {
  const connection = readConfig().databaseUrl;
  if (state.rutasPool && state.rutasPoolKey !== connection)
    throw new AppError("RESTART_REQUIRED", 503);
  state.rutasPoolKey = connection;
  return (state.rutasPool ||= createPool(connection));
}
export async function transaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function assertInstallation(sql: Sql, instanceId: string) {
  const result = await sql.query(
    "SELECT instance_id FROM rutas_installation WHERE singleton = true",
  );
  if (result.rows[0]?.instance_id !== instanceId)
    throw new AppError("INSTALLATION_MISMATCH", 503);
}
export async function migrate(pool: Pool, instanceId: string) {
  await transaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('ana-rutas:migrations'))",
    );
    const tables = await client.query(
      "SELECT c.relname AS tablename FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')",
    );
    const names = tables.rows.map((row) => row.tablename);
    if (!names.includes("rutas_installation") && names.length)
      throw new AppError("DATABASE_NOT_DEDICATED", 503);
    if (names.includes("rutas_installation")) {
      await assertInstallation(client, instanceId);
      const result = await client.query(
        "SELECT schema_version FROM rutas_installation WHERE singleton = true",
      );
      if (![1, 2, 3].includes(result.rows[0]?.schema_version))
        throw new AppError("SCHEMA_VERSION_UNSUPPORTED", 503);
      if (result.rows[0]?.schema_version === 1) await migrateFleet(client);
      if (result.rows[0]?.schema_version < 3) await migrateOrders(client);
      return;
    }
    await client.query(`
      CREATE TABLE rutas_installation (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), instance_id text NOT NULL, schema_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE route_users (id uuid PRIMARY KEY, name text NOT NULL, login text NOT NULL UNIQUE, password_hash text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE route_sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES route_users(id), created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, idle_expires_at timestamptz NOT NULL, revoked_at timestamptz);
      CREATE INDEX route_sessions_user ON route_sessions(user_id);
      CREATE TABLE auth_attempts (key text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL);
      CREATE TABLE route_plans (id uuid PRIMARY KEY, service_date date NOT NULL UNIQUE, label text NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version > 0), created_by uuid NOT NULL REFERENCES route_users(id), updated_by uuid NOT NULL REFERENCES route_users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE route_audit (id bigserial PRIMARY KEY, actor_id uuid REFERENCES route_users(id), action text NOT NULL, entity_id text, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
    `);
    await client.query(
      "INSERT INTO rutas_installation(singleton, instance_id, schema_version) VALUES(true, $1, 1)",
      [instanceId],
    );
    await migrateFleet(client);
    await migrateOrders(client);
  });
}
export async function audit(
  sql: Sql,
  actor: string | null,
  action: string,
  entity: string | null = null,
  details: Record<string, unknown> = {},
) {
  await sql.query(
    "INSERT INTO route_audit(actor_id,action,entity_id,details) VALUES($1,$2,$3,$4)",
    [actor, action, entity, JSON.stringify(details)],
  );
}
export async function assertActiveActor(sql: Sql, actor: string) {
  const { rows } = await sql.query(
    "SELECT active FROM route_users WHERE id=$1 FOR SHARE",
    [actor],
  );
  if (!rows[0]?.active) throw new AppError("UNAUTHENTICATED", 401);
}
