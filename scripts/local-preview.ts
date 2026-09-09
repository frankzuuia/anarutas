import { spawn } from "node:child_process";
import { freePort } from "../tests/helpers/postgres";
import EmbeddedPostgres from "embedded-postgres";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { createPool, migrate } from "../src/core/database";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const localRoot = resolve(".local");
await mkdir(localRoot, { recursive: true });
const settingsPath = resolve(localRoot, "preview-runtime.json");
type Settings = {
  dbPort: number;
  webPort: number;
  password: string;
  instanceId: string;
  bootstrapToken: string;
};
let settings: Settings;
let fresh = false;
try {
  settings = JSON.parse(await readFile(settingsPath, "utf8"));
} catch (error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "ENOENT"
  )
    throw error;
  settings = {
    dbPort: await freePort(),
    webPort: await freePort(),
    password: randomBytes(32).toString("hex"),
    instanceId: randomUUID(),
    bootstrapToken: randomBytes(32).toString("hex"),
  };
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  fresh = true;
}
const pg = new EmbeddedPostgres({
  databaseDir: resolve(localRoot, "preview-db"),
  user: "postgres",
  password: settings.password,
  port: settings.dbPort,
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: () => {},
});
if (fresh) await pg.initialise();
await pg.start();
const databaseUrl = `postgresql://postgres:${settings.password}@127.0.0.1:${settings.dbPort}/postgres`;
const pool = createPool(databaseUrl);
await migrate(pool, settings.instanceId);
await pool.end();
const origin = `http://127.0.0.1:${settings.webPort}`;
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(settings.webPort),
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      RUTAS_DATABASE_URL: databaseUrl,
      RUTAS_INSTANCE_ID: settings.instanceId,
      RUTAS_APP_ORIGIN: origin,
      RUTAS_TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone,
      RUTAS_BOOTSTRAP_TOKEN:
        process.env.RUTAS_BOOTSTRAP_TOKEN || settings.bootstrapToken,
      ODOO_URL: "",
      ODOO_DATABASE: "",
      ODOO_EMAIL: "",
      ODOO_USERNAME: "",
      ODOO_API_KEY: "",
      ODOO_PASSWORD: "",
      ODOO_COMPANY_ID: "",
    },
  },
);
console.log(`Ana Rutas local: ${origin}/setup`);
console.log(
  "PostgreSQL local persistente, sin datos Odoo ni cuentas predefinidas.",
);
console.log(
  "La clave de activación está en .local/preview-runtime.json (bootstrapToken). No compartas ese archivo.",
);
child.on("exit", async () => {
  await pg.stop();
});
process.on("SIGINT", () => {
  child.kill("SIGINT");
});
