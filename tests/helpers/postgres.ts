import EmbeddedPostgres from "embedded-postgres";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { createPool, migrate } from "../../src/core/database";
import { readConfig } from "../../src/core/config";

type TestPool = ReturnType<typeof createPool>;

// Only for reconstructing pre-v20 schemas in isolated migration tests.
export async function dropExecutionTablesForLegacyFixture(pool: TestPool) {
  await pool.query("DROP TABLE route_driver_incident_events,route_driver_incident_orders,route_driver_incident_evidence,route_driver_service_incidents,route_driver_execution_orders,route_driver_command_receipts,route_driver_stop_events,route_driver_execution_stops,route_driver_executions,route_driver_operation_settings CASCADE; DROP FUNCTION seed_driver_execution_orders()");
}

async function captureCleanupFailure(
  errors: unknown[],
  cleanup: () => Promise<unknown>,
) {
  try {
    await cleanup();
  } catch (error) {
    errors.push(error);
  }
}

async function disposeTestPostgres(
  pool: TestPool | undefined,
  server: EmbeddedPostgres | undefined,
  databaseDir: string,
) {
  const errors: unknown[] = [];
  if (pool)
    await captureCleanupFailure(errors, async () => {
      await pool.end();
    });
  if (server)
    await captureCleanupFailure(errors, async () => {
      await server.stop();
    });
  await captureCleanupFailure(errors, async () => {
    await rm(databaseDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
  if (errors.length)
    throw new AggregateError(errors, "TEST_POSTGRES_CLEANUP_FAILED");
}

async function cleanupFailedStart(
  originalError: unknown,
  pool: TestPool | undefined,
  server: EmbeddedPostgres | undefined,
  databaseDir: string,
): Promise<never> {
  try {
    await disposeTestPostgres(pool, server, databaseDir);
  } catch (cleanupError) {
    throw new AggregateError(
      [originalError, cleanupError],
      "TEST_POSTGRES_START_AND_CLEANUP_FAILED",
    );
  }
  throw originalError;
}

export async function freePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("PORT_ALLOCATION_FAILED");
  await new Promise<void>((done, fail) =>
    server.close((error) => (error ? fail(error) : done())),
  );
  return address.port;
}
export async function startPostgres(options: { databaseRoot?: string } = {}) {
  const root = resolve(options.databaseRoot ?? ".local");
  await mkdir(root, { recursive: true });
  const port = await freePort();
  const password = randomBytes(32).toString("hex");
  const databaseDir = await mkdtemp(resolve(root, "pg-"));
  let server: EmbeddedPostgres | undefined;
  let pool: TestPool | undefined;
  let config: ReturnType<typeof readConfig>;
  try {
    server = new EmbeddedPostgres({
      databaseDir,
      user: "postgres",
      password,
      port,
      // This helper owns disposal. embedded-postgres otherwise removes the folder
      // once, before Windows releases all child-process file handles, and raises
      // EBUSY even if our retrying cleanup below subsequently succeeds.
      persistent: true,
      authMethod: "scram-sha-256",
      postgresFlags: ["-h", "127.0.0.1"],
      createPostgresUser: false,
      onLog: () => {},
      onError: () => {},
    });
    await server.initialise();
    await server.start();
    const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
    config = readConfig({
      RUTAS_INSTANCE_ID: randomUUID(),
      RUTAS_APP_ORIGIN: "http://127.0.0.1:3000",
      RUTAS_DATABASE_URL: databaseUrl,
      RUTAS_TIMEZONE: "UTC",
      RUTAS_BOOTSTRAP_TOKEN: randomBytes(32).toString("hex"),
    });
    pool = createPool(databaseUrl);
    await migrate(pool, config.instanceId);
  } catch (error) {
    return cleanupFailedStart(error, pool, server, databaseDir);
  }
  let closePromise: Promise<void> | undefined;
  const readyPool = pool;
  const readyServer = server;
  return {
    server: readyServer,
    pool: readyPool,
    config,
    databaseDir,
    close() {
      closePromise ??= disposeTestPostgres(readyPool, readyServer, databaseDir);
      return closePromise;
    },
  };
}
