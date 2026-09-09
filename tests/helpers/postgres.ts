import EmbeddedPostgres from "embedded-postgres";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { createPool, migrate } from "../../src/core/database";
import { readConfig } from "../../src/core/config";

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
export async function startPostgres() {
  const root = resolve(".local");
  await mkdir(root, { recursive: true });
  const databaseDir = await mkdtemp(resolve(root, "pg-"));
  const port = await freePort();
  const password = randomBytes(32).toString("hex");
  const server = new EmbeddedPostgres({
    databaseDir,
    user: "postgres",
    password,
    port,
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
  const config = readConfig({
    RUTAS_INSTANCE_ID: randomUUID(),
    RUTAS_APP_ORIGIN: "http://127.0.0.1:3000",
    RUTAS_DATABASE_URL: databaseUrl,
    RUTAS_TIMEZONE: "UTC",
    RUTAS_BOOTSTRAP_TOKEN: randomBytes(32).toString("hex"),
  });
  const pool = createPool(databaseUrl);
  await migrate(pool, config.instanceId);
  return {
    server,
    pool,
    config,
    databaseDir,
    async close() {
      await pool.end();
      await server.stop();
    },
  };
}
