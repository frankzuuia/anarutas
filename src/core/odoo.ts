import { randomUUID } from "node:crypto";
import { readOdooConfig } from "./config";
import { AppError } from "./errors";

type OdooConfig = ReturnType<typeof readOdooConfig>;
// Not exported: callers cannot select arbitrary models, methods, hosts or credentials.
async function rpc(
  config: OdooConfig,
  service: string,
  method: string,
  args: unknown[],
) {
  const id = randomUUID();
  let response: Response;
  try {
    response = await fetch(`${config.url}/jsonrpc`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service, method, args },
        id,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    throw new AppError("ODOO_UNAVAILABLE", 502);
  }
  if (!response.ok) throw new AppError("ODOO_UNAVAILABLE", 502);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new AppError("ODOO_INVALID_RESPONSE", 502);
  }
  if (data.id !== id || data.error || !Object.hasOwn(data, "result"))
    throw new AppError("ODOO_DENIED", 502);
  return data.result;
}
export function odooPublicStatus() {
  try {
    const config = readOdooConfig();
    return {
      configured: true,
      host: new URL(config.url).hostname,
      database: config.database,
      companyId: config.companyId,
      mode: "read-only",
    };
  } catch {
    return { configured: false, mode: "read-only" };
  }
}
export async function diagnoseOdoo(config = readOdooConfig()) {
  const version = await rpc(config, "common", "version", []);
  const uid = await rpc(config, "common", "authenticate", [
    config.database,
    config.username,
    config.credential,
    {},
  ]);
  if (!Number.isSafeInteger(uid) || uid <= 0)
    throw new AppError("ODOO_DENIED", 502);
  const prefix = [config.database, uid, config.credential];
  const users = await rpc(config, "object", "execute_kw", [
    ...prefix,
    "res.users",
    "read",
    [[uid]],
    { fields: ["company_ids"] },
  ]);
  if (
    !Array.isArray(users) ||
    !users[0]?.company_ids?.includes(config.companyId)
  )
    throw new AppError("ODOO_COMPANY_DENIED", 403);
  const companies = await rpc(config, "object", "execute_kw", [
    ...prefix,
    "res.company",
    "read",
    [[config.companyId]],
    { fields: ["name"], context: { allowed_company_ids: [config.companyId] } },
  ]);
  if (
    !Array.isArray(companies) ||
    companies.length !== 1 ||
    companies[0].id !== config.companyId
  )
    throw new AppError("ODOO_INVALID_RESPONSE", 502);
  return {
    connected: true,
    version: String(version.server_version),
    company: String(companies[0].name),
    companyId: config.companyId,
    fingerprint: config.fingerprint,
    mode: "read-only",
    checkedAt: new Date().toISOString(),
  };
}
