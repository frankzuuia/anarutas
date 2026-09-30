import type { Pool, PoolClient } from "pg";
import { AppError } from "./errors";
import { assertInstallation } from "./database";
import { readOdooConfig } from "./config";
import { readFinancialSources } from "./odoo";
import {
  financialRetrySeconds,
  financialSyncConfig,
  type FinancialSyncConfig,
} from "./financial-config";
import {
  acquireFinancialSync,
  dueFinancialTargets,
  persistFinancialSnapshot,
  releaseFinancialSync,
} from "./financial-store";
import type { FinancialTarget } from "./financial-contract";

export function financialError(error: unknown) {
  // Persist only our stable code, never supplier response bodies, URLs or credentials.
  return error instanceof AppError ? error.code : "FINANCIAL_SYNC_UNAVAILABLE";
}
export async function recordFinancialFailure(
  client: PoolClient,
  source: string,
  targets: FinancialTarget[],
  error: unknown,
  failures: number,
  config: FinancialSyncConfig,
  durationMs: number,
) {
  const code = financialError(error);
  const rawRetry =
    error instanceof AppError ? error.details?.retryAfterSeconds : undefined;
  const retryAfter =
    typeof rawRetry === "number" && Number.isFinite(rawRetry) && rawRetry >= 0
      ? rawRetry
      : 0;
  const delay = financialRetrySeconds(failures, config, retryAfter);
  await client.query(
    `UPDATE route_financial_sync_state SET failures=failures+1,last_error=$2,last_checked_at=now(),
    last_duration_ms=$3,attempts=attempts+1,errors=errors+1,rate_limits=rate_limits+$4,
    next_attempt_at=now()+make_interval(secs=>$5) WHERE source=$1`,
    [source, code, durationMs, code === "ODOO_RATE_LIMITED" ? 1 : 0, delay],
  );
  for (const target of targets) {
    await client.query(
      `UPDATE route_financial_targets SET failures=failures+1,last_error=$4,last_checked_at=now(),
      attempts=attempts+1,last_duration_ms=$5,next_attempt_at=now()+make_interval(secs=>$6)
      WHERE source=$1 AND picking_id=$2 AND order_id=$3`,
      [source, target.pickingId, target.orderId, code, durationMs, delay],
    );
  }
  return { code, retrySeconds: delay };
}

export async function syncFinancialSources(
  pool: Pool,
  instanceId: string,
  odoo = readOdooConfig(),
  config = financialSyncConfig(),
) {
  const client = await pool.connect();
  let acquired = false;
  let discard = false;
  // An idle client can disconnect while RPC is pending. Capture it and refuse persistence.
  let disconnected = false;
  const onError = () => {
    disconnected = true;
  };
  client.on("error", onError);
  try {
    await assertInstallation(client, instanceId);
    const bound = await client.query(
      "SELECT fingerprint FROM route_order_source WHERE singleton=true",
    );
    if (!bound.rows.length) return { status: "idle" as const };
    if (bound.rows[0].fingerprint !== odoo.fingerprint)
      throw new AppError("ODOO_SOURCE_CHANGED", 409);
    acquired = await acquireFinancialSync(client, odoo.fingerprint);
    if (!acquired) return { status: "busy" as const };
    await client.query(
      "INSERT INTO route_financial_sync_state(source) VALUES($1) ON CONFLICT DO NOTHING",
      [odoo.fingerprint],
    );
    const state = await client.query(
      "SELECT failures,next_attempt_at<=now() AS due FROM route_financial_sync_state WHERE source=$1",
      [odoo.fingerprint],
    );
    if (!state.rows[0].due) return { status: "cooldown" as const };
    // The queue isolates failed targets independently of the source cooldown.
    const targets = await dueFinancialTargets(
      client,
      odoo.fingerprint,
      config.batchSize,
    );
    if (!targets.length) return { status: "idle" as const };
    const start = performance.now();
    try {
      const snapshots = await readFinancialSources(
        targets,
        odoo,
        config.metadataTtlSeconds * 1000,
      );
      if (disconnected)
        throw new AppError("FINANCIAL_SYNC_CONNECTION_LOST", 503);
      const durationMs = Math.ceil(performance.now() - start);
      await client.query("BEGIN");
      let changed = 0;
      for (const snapshot of snapshots) {
        const result = await persistFinancialSnapshot(
          client,
          snapshot,
          config.pollSeconds,
          durationMs,
        );
        if (result.changed) changed++;
      }
      await client.query(
        `UPDATE route_financial_sync_state SET failures=0,last_error=NULL,last_checked_at=now(),last_success_at=now(),
        last_duration_ms=$2,attempts=attempts+1,next_attempt_at=now() WHERE source=$1`,
        [odoo.fingerprint, durationMs],
      );
      await client.query("COMMIT");
      return {
        status: "synced" as const,
        inspected: snapshots.length,
        changed,
        durationMs,
      };
    } catch (error) {
      if (disconnected) throw error;
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      const failure = await recordFinancialFailure(
        client,
        odoo.fingerprint,
        targets,
        error,
        state.rows[0].failures,
        config,
        Math.ceil(performance.now() - start),
      );
      await client.query("COMMIT");
      return { status: "failed" as const, ...failure };
    }
  } catch (error) {
    discard = true;
    throw error;
  } finally {
    if (acquired && !disconnected) {
      try {
        await releaseFinancialSync(client, odoo.fingerprint);
      } catch {
        discard = true;
      }
    }
    client.removeListener("error", onError);
    client.release(discard || disconnected);
  }
}
