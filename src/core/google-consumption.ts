import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "./errors";
import { assertActiveActor, audit, transaction, type Sql } from "./database";
import {
  readGoogleConsumptionConfig,
  type GoogleConsumptionConfig,
} from "./google-consumption-config";
import type {
  GoogleConsumptionSnapshot,
  GoogleConsumptionState,
} from "./google-consumption-contract";
import { requestGoogleConsumption } from "./google-consumption-bigquery";

type Env = Record<string, string | undefined>;
type Dependencies = {
  env?: Env;
  request?: (
    config: GoogleConsumptionConfig,
  ) => Promise<GoogleConsumptionSnapshot>;
};

type StateRow = {
  status: "idle" | "running" | "ready" | "failed";
  token: string | null;
  lease_until: Date | string | null;
  last_attempt_at: Date | string | null;
  last_success_at: Date | string | null;
  next_sync_at: Date | string;
  error_code: string | null;
  snapshot: unknown;
};

function iso(value: Date | string | null) {
  if (value === null) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time))
    throw new AppError("GOOGLE_CONSUMPTION_CACHE_INVALID", 503);
  return new Date(time).toISOString();
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("GOOGLE_CONSUMPTION_CACHE_INVALID", 503);
  return value as Record<string, unknown>;
}

function text(value: unknown): string;
function text(value: unknown, nullable: false): string;
function text(value: unknown, nullable: true): string | null;
function text(value: unknown, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !value.length)
    throw new AppError("GOOGLE_CONSUMPTION_CACHE_INVALID", 503);
  return value;
}

function numeric(value: unknown): number;
function numeric(value: unknown, nullable: false): number;
function numeric(value: unknown, nullable: true): number | null;
function numeric(value: unknown, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new AppError("GOOGLE_CONSUMPTION_CACHE_INVALID", 503);
  return value;
}

export function parseConsumptionSnapshot(
  value: unknown,
): GoogleConsumptionSnapshot {
  const root = record(value);
  if (
    !Array.isArray(root.skus) ||
    !Array.isArray(root.days) ||
    !Array.isArray(root.months)
  )
    throw new AppError("GOOGLE_CONSUMPTION_CACHE_INVALID", 503);
  const levels = new Set([
    "healthy",
    "attention",
    "warning",
    "critical",
    "charging",
    "unpriced",
  ]);
  const skus = root.skus.map((raw) => {
    const item = record(raw);
    const level = text(item.level);
    if (!levels.has(level))
      throw new AppError("GOOGLE_CONSUMPTION_CACHE_INVALID", 503);
    return {
      skuId: text(item.skuId),
      skuName: text(item.skuName),
      serviceName: text(item.serviceName),
      usage: numeric(item.usage),
      pricingUnit: text(item.pricingUnit),
      freeLimit: numeric(item.freeLimit, true),
      remaining: numeric(item.remaining, true),
      percentage: numeric(item.percentage, true),
      nextTierPrice: numeric(item.nextTierPrice, true),
      nextTierQuantity: numeric(item.nextTierQuantity, true),
      grossCost: numeric(item.grossCost),
      credits: numeric(item.credits),
      netCost: numeric(item.netCost),
      level: level as GoogleConsumptionSnapshot["skus"][number]["level"],
    };
  });
  const costRows = (values: unknown[], period: "date" | "periodStart") =>
    values.map((raw) => {
      const item = record(raw);
      return {
        [period]: text(item[period]),
        grossCost: numeric(item.grossCost),
        credits: numeric(item.credits),
        netCost: numeric(item.netCost),
      };
    });
  const providerExportTime = text(root.providerExportTime, true);
  const pricingAsOfTime = text(root.pricingAsOfTime);
  if (
    (providerExportTime !== null &&
      !Number.isFinite(Date.parse(providerExportTime))) ||
    !Number.isFinite(Date.parse(pricingAsOfTime))
  )
    throw new AppError("GOOGLE_CONSUMPTION_CACHE_INVALID", 503);
  return {
    mapsProjectId: text(root.mapsProjectId),
    currentPeriod: text(root.currentPeriod),
    currency: text(root.currency),
    providerExportTime,
    pricingAsOfTime,
    grossCost: numeric(root.grossCost),
    credits: numeric(root.credits),
    netCost: numeric(root.netCost),
    maximumPercentage: numeric(root.maximumPercentage, true),
    skus,
    days: costRows(root.days, "date") as GoogleConsumptionSnapshot["days"],
    months: costRows(
      root.months,
      "periodStart",
    ) as GoogleConsumptionSnapshot["months"],
  };
}

async function readRow(sql: Sql) {
  const { rows } = await sql.query(
    `SELECT status,token,lease_until,last_attempt_at,last_success_at,next_sync_at,
            error_code,snapshot
       FROM route_google_consumption_state WHERE singleton=true`,
  );
  if (!rows[0]) throw new AppError("GOOGLE_CONSUMPTION_CACHE_INVALID", 503);
  return rows[0] as StateRow;
}

export async function getGoogleConsumptionState(
  sql: Sql,
  env: Env = process.env,
  now = Date.now(),
): Promise<GoogleConsumptionState> {
  const config = readGoogleConsumptionConfig(env);
  if (!config)
    return {
      configured: false,
      status: "unconfigured",
      lastAttemptAt: null,
      lastSuccessAt: null,
      nextSyncAt: null,
      errorCode: null,
      snapshot: null,
    };
  const row = await readRow(sql);
  const snapshot =
    row.snapshot === null ? null : parseConsumptionSnapshot(row.snapshot);
  const currentSnapshot =
    snapshot?.mapsProjectId === config.mapsProjectId ? snapshot : null;
  const lastAttemptAt = iso(row.last_attempt_at);
  const lastSuccessAt = iso(row.last_success_at);
  const nextSyncAt = iso(row.next_sync_at);
  const running =
    row.status === "running" &&
    row.lease_until !== null &&
    Date.parse(iso(row.lease_until)!) > now;
  const tooOld =
    lastSuccessAt !== null &&
    now - Date.parse(lastSuccessAt) > config.syncMinutes * 2 * 60_000;
  return {
    configured: true,
    status: running
      ? "syncing"
      : currentSnapshot === null
        ? "empty"
        : row.status === "failed" || tooOld
          ? "stale"
          : "ready",
    lastAttemptAt,
    lastSuccessAt,
    nextSyncAt,
    errorCode: row.error_code,
    snapshot: currentSnapshot,
  };
}

async function claim(pool: Pool, actor: string | null, force: boolean) {
  return transaction(pool, async (client) => {
    if (actor) await assertActiveActor(client, actor);
    const token = randomUUID();
    const result = await client.query(
      `UPDATE route_google_consumption_state
          SET status='running',token=$1,lease_until=now()+interval '2 minutes',
              last_attempt_at=now(),error_code=NULL,updated_by=$2,updated_at=now()
        WHERE singleton=true
          AND (status<>'running' OR lease_until IS NULL OR lease_until<=now())
          AND ($3::boolean OR next_sync_at<=now())
      RETURNING token`,
      [token, actor, force],
    );
    if (!result.rowCount) return null;
    await audit(client, actor, "google.consumption.sync.requested", null, {
      source: "cloud_billing_bigquery",
    });
    return token;
  });
}

async function complete(
  pool: Pool,
  actor: string | null,
  token: string,
  snapshot: GoogleConsumptionSnapshot,
  syncMinutes: number,
) {
  return transaction(pool, async (client) => {
    const result = await client.query(
      `UPDATE route_google_consumption_state
          SET status='ready',token=NULL,lease_until=NULL,last_success_at=now(),
              next_sync_at=now()+($1::integer * interval '1 minute'),
              error_code=NULL,provider_export_time=$2,snapshot=$3::jsonb,
              updated_by=$4,updated_at=now()
        WHERE singleton=true AND token=$5
      RETURNING singleton`,
      [
        syncMinutes,
        snapshot.providerExportTime,
        JSON.stringify(snapshot),
        actor,
        token,
      ],
    );
    if (!result.rowCount) return false;
    await audit(client, actor, "google.consumption.synced", null, {
      source: "cloud_billing_bigquery",
      projectId: snapshot.mapsProjectId,
      currentPeriod: snapshot.currentPeriod,
      skuCount: snapshot.skus.length,
      providerExportTime: snapshot.providerExportTime,
    });
    return true;
  });
}

function publicError(error: unknown) {
  return error instanceof AppError &&
    error.code.startsWith("GOOGLE_CONSUMPTION_")
    ? error.code
    : "GOOGLE_CONSUMPTION_UNAVAILABLE";
}

async function fail(
  pool: Pool,
  actor: string | null,
  token: string,
  error: unknown,
  retryMinutes: number,
) {
  await transaction(pool, async (client) => {
    const code = publicError(error);
    const result = await client.query(
      `UPDATE route_google_consumption_state
          SET status='failed',token=NULL,lease_until=NULL,error_code=$1,
              next_sync_at=now()+($2::integer * interval '1 minute'),
              updated_by=$3,updated_at=now()
        WHERE singleton=true AND token=$4
      RETURNING singleton`,
      [code, retryMinutes, actor, token],
    );
    if (result.rowCount)
      await audit(client, actor, "google.consumption.sync.failed", null, {
        source: "cloud_billing_bigquery",
        errorCode: code,
      });
  });
}

async function synchronize(
  pool: Pool,
  actor: string | null,
  force: boolean,
  dependencies: Dependencies,
) {
  const env = dependencies.env || process.env;
  const config = readGoogleConsumptionConfig(env);
  if (!config) {
    if (force) throw new AppError("GOOGLE_CONSUMPTION_CONFIG_MISSING", 503);
    return false;
  }
  const token = await claim(pool, actor, force);
  if (!token) return false;
  try {
    const snapshot = await (dependencies.request || requestGoogleConsumption)(
      config,
    );
    await complete(pool, actor, token, snapshot, config.syncMinutes);
    return true;
  } catch (error) {
    await fail(pool, actor, token, error, Math.min(config.syncMinutes, 15));
    throw error;
  }
}

export async function refreshGoogleConsumption(
  pool: Pool,
  actor: string,
  dependencies: Dependencies = {},
) {
  await synchronize(pool, actor, true, dependencies);
  return getGoogleConsumptionState(pool, dependencies.env || process.env);
}

export function processGoogleConsumptionSync(
  pool: Pool,
  dependencies: Dependencies = {},
) {
  return synchronize(pool, null, false, dependencies);
}
