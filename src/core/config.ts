import { createHash } from "node:crypto";
import { AppError } from "./errors";

type Env = Record<string, string | undefined>;
function required(env: Env, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new AppError("CONFIG_MISSING", 503);
  return value;
}
function positive(env: Env, key: string, fallback: number) {
  const raw = env[key]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new AppError("CONFIG_INVALID", 503);
  return value;
}
function url(raw: string) {
  try {
    return new URL(raw);
  } catch {
    throw new AppError("CONFIG_INVALID", 503);
  }
}
export function readConfig(env: Env = process.env) {
  const origin = url(required(env, "RUTAS_APP_ORIGIN"));
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    (origin.protocol !== "https:" && !(local && origin.protocol === "http:")) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new AppError("CONFIG_INVALID", 503);
  const databaseUrl = required(env, "RUTAS_DATABASE_URL");
  const database = url(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !database.hostname ||
    !database.username ||
    !database.password ||
    database.pathname.length < 2 ||
    database.hash ||
    ["host", "port", "user", "password", "dbname", "database"].some((key) =>
      database.searchParams.has(key),
    )
  )
    throw new AppError("CONFIG_INVALID", 503);
  const timezone = required(env, "RUTAS_TIMEZONE");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new AppError("CONFIG_INVALID", 503);
  }
  const instanceId = required(env, "RUTAS_INSTANCE_ID");
  if (instanceId.length > 100) throw new AppError("CONFIG_INVALID", 503);
  return {
    instanceId,
    origin: origin.origin,
    databaseUrl,
    timezone,
    displayName: env.RUTAS_DISPLAY_NAME?.trim() || "Ana Rutas",
    secureCookie: origin.protocol === "https:",
    cookieName:
      origin.protocol === "https:" ? "__Host-ana-rutas" : "ana-rutas-local",
    sessionHours: positive(env, "RUTAS_SESSION_HOURS", 12),
    idleMinutes: positive(env, "RUTAS_IDLE_MINUTES", 30),
    bootstrapToken: env.RUTAS_BOOTSTRAP_TOKEN || "",
  };
}
export function readOdooConfig(env: Env = process.env) {
  const endpoint = url(required(env, "ODOO_URL"));
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/"
  )
    throw new AppError("ODOO_CONFIG_INVALID", 503);
  const database = required(env, "ODOO_DATABASE");
  const username = env.ODOO_USERNAME?.trim() || required(env, "ODOO_EMAIL");
  const credential = env.ODOO_API_KEY || required(env, "ODOO_PASSWORD");
  const companyId = positive(env, "ODOO_COMPANY_ID", 0);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([endpoint.origin, database, companyId]))
    .digest("hex");
  return {
    url: endpoint.origin,
    database,
    username,
    credential,
    companyId,
    fingerprint,
    timeoutMs: positive(env, "RUTAS_ODOO_TIMEOUT_MS", 15000),
  };
}
