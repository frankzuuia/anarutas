import { AppError } from "./errors";

export function financialSyncConfig(
  env: Record<string, string | undefined> = process.env,
) {
  function integer(key: string, fallback: number, max: number) {
    const value = env[key]?.trim() ? Number(env[key]) : fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw new AppError("FINANCIAL_CONFIG_INVALID", 503);
    return value;
  }
  return {
    // Operational rate controls, not limits on money/quantities or cognitive output.
    pollSeconds: integer("RUTAS_FINANCIAL_POLL_SECONDS", 60, 86400),
    batchSize: integer("RUTAS_FINANCIAL_BATCH_SIZE", 20, 100),
    retrySeconds: integer("RUTAS_FINANCIAL_RETRY_SECONDS", 60, 86400),
    maxRetrySeconds: integer("RUTAS_FINANCIAL_MAX_RETRY_SECONDS", 3600, 604800),
    metadataTtlSeconds: integer(
      "RUTAS_FINANCIAL_METADATA_TTL_SECONDS",
      900,
      86400,
    ),
  };
}
export type FinancialSyncConfig = ReturnType<typeof financialSyncConfig>;
export function financialRetrySeconds(
  failures: number,
  config: FinancialSyncConfig,
  retryAfterSeconds = 0,
) {
  return Math.max(
    retryAfterSeconds,
    Math.min(
      config.maxRetrySeconds,
      config.retrySeconds * 2 ** Math.min(failures, 30),
    ),
  );
}
