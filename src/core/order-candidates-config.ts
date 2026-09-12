import { AppError } from "./errors";

export function candidateConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const number = (key: string, fallback: number) => {
    const value =
      env[key] === undefined || env[key] === "" ? fallback : Number(env[key]);
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new AppError("CONFIG_INVALID", 503);
    return value;
  };
  return {
    ttlSeconds: number("RUTAS_ORDER_BATCH_TTL_SECONDS", 1800),
    receiptSeconds: number("RUTAS_ORDER_RECEIPT_TTL_SECONDS", 86400),
    maxCandidates: number("RUTAS_ORDER_MAX_CANDIDATES", 5000),
    timeoutMs: number("RUTAS_ORDER_QUERY_TIMEOUT_MS", 120000),
    requestsPerMinute: number("RUTAS_ORDER_REQUESTS_PER_MINUTE", 10),
  };
}
