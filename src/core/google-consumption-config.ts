import { AppError } from "./errors";
import {
  decodeGoogleServiceAccount,
  type GoogleServiceAccount,
} from "./routing-config";

type Env = Record<string, string | undefined>;

export type GoogleConsumptionConfig = {
  mapsProjectId: string;
  queryProjectId: string;
  datasetId: string;
  location: string;
  credentials: GoogleServiceAccount;
  syncMinutes: number;
  maximumBytesBilled: number;
};

const finopsKeys = [
  "RUTAS_GOOGLE_FINOPS_SERVICE_ACCOUNT_JSON_BASE64",
  "RUTAS_GOOGLE_BILLING_EXPORT_PROJECT_ID",
  "RUTAS_GOOGLE_BILLING_EXPORT_DATASET_ID",
  "RUTAS_GOOGLE_BILLING_EXPORT_LOCATION",
] as const;

function identifier(value: string, allowed: string, maximum: number) {
  return (
    value.length > 0 &&
    value.length <= maximum &&
    [...value].every((character) => allowed.includes(character))
  );
}

function positiveInteger(
  env: Env,
  key: string,
  fallback: number,
  maximum: number,
) {
  const raw = env[key]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
    throw new AppError("GOOGLE_CONSUMPTION_CONFIG_INVALID", 503);
  return value;
}

export function readGoogleConsumptionConfig(
  env: Env = process.env,
): GoogleConsumptionConfig | null {
  const configuredValues = finopsKeys.map((key) => env[key]?.trim() || "");
  if (configuredValues.every((value) => !value)) return null;
  if (configuredValues.some((value) => !value))
    throw new AppError("GOOGLE_CONSUMPTION_CONFIG_INVALID", 503);
  const mapsProjectId = env.RUTAS_GOOGLE_CLOUD_PROJECT_ID?.trim() || "";
  const queryProjectId = configuredValues[1];
  const datasetId = configuredValues[2];
  const location = configuredValues[3];
  if (
    !identifier(mapsProjectId, "abcdefghijklmnopqrstuvwxyz0123456789-", 200) ||
    !identifier(queryProjectId, "abcdefghijklmnopqrstuvwxyz0123456789-", 200) ||
    !identifier(
      datasetId,
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_",
      1024,
    ) ||
    !identifier(
      location,
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-",
      100,
    )
  )
    throw new AppError("GOOGLE_CONSUMPTION_CONFIG_INVALID", 503);
  return {
    mapsProjectId,
    queryProjectId,
    datasetId,
    location,
    credentials: decodeGoogleServiceAccount(
      configuredValues[0],
      "GOOGLE_CONSUMPTION_CONFIG_INVALID",
    ),
    syncMinutes: positiveInteger(
      env,
      "RUTAS_GOOGLE_CONSUMPTION_SYNC_MINUTES",
      30,
      1440,
    ),
    maximumBytesBilled: positiveInteger(
      env,
      "RUTAS_GOOGLE_BIGQUERY_MAX_BYTES_BILLED",
      100_000_000,
      1_000_000_000_000,
    ),
  };
}
