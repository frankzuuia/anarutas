import { randomUUID } from "node:crypto";
import { readOdooConfig } from "./config";
import { AppError } from "./errors";
import { odooRetryAfter } from "./odoo-retry";

/** Internal transport. Only closed domain connectors may expose operations to callers. */
export async function odooRpc(
  config: ReturnType<typeof readOdooConfig>,
  service: string,
  method: string,
  args: unknown[],
): Promise<unknown> {
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
  if (response.status === 429)
    throw new AppError("ODOO_RATE_LIMITED", 503, {
      retryAfterSeconds: odooRetryAfter(response.headers.get("Retry-After")),
    });
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
