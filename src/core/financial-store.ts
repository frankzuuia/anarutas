import type { Pool, PoolClient } from "pg";
import { AppError } from "./errors";
import { assertActiveActor, audit, transaction } from "./database";
import { financialHash } from "./financial-policy";
import type { FinancialSnapshot, FinancialTarget } from "./financial-contract";
import { uuid } from "./orders-validation";

/** The client holding this lock must also perform persistence; never return it to the pool locked. */
export async function acquireFinancialSync(client: PoolClient, source: string) {
  const result = await client.query(
    "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired",
    [`ana-rutas:finance:${source}`],
  );
  return result.rows[0].acquired === true;
}
export async function releaseFinancialSync(client: PoolClient, source: string) {
  await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
    `ana-rutas:finance:${source}`,
  ]);
}
export async function dueFinancialTargets(
  client: PoolClient,
  source: string,
  limit: number,
): Promise<FinancialTarget[]> {
  const result = await client.query(
    `SELECT t.source,t.picking_id,t.order_id,t.partner_id,t.failures FROM route_financial_targets t
    WHERE t.source=$1 AND t.next_attempt_at<=now() AND EXISTS(
      SELECT 1 FROM route_shipments s JOIN route_plans p ON p.id=s.plan_id
      WHERE (s.source,s.picking_id,s.order_id)=(t.source,t.picking_id,t.order_id) AND p.archived_at IS NULL)
    ORDER BY t.next_attempt_at,t.picking_id,t.order_id LIMIT $2`,
    [source, limit],
  );
  // Failed targets retry alone even after a different target succeeds. Otherwise a
  // poisoned record can repeatedly invalidate healthy batches and starve them.
  const batch =
    result.rows[0]?.failures > 0
      ? result.rows.slice(0, 1)
      : result.rows.filter((row) => row.failures === 0);
  return batch.map((row) => ({
    source: row.source,
    pickingId: Number(row.picking_id),
    orderId: Number(row.order_id),
    partnerId: Number(row.partner_id),
  }));
}

/** Call inside a transaction. The source lock serializes worker observations across replicas. */
export async function persistFinancialSnapshot(
  client: PoolClient,
  snapshot: FinancialSnapshot,
  pollSeconds: number,
  durationMs: number,
) {
  const { target } = snapshot;
  const key = [target.source, target.pickingId, target.orderId];
  const { rows } = await client.query(
    `SELECT partner_id,revision,content_hash FROM route_financial_targets
    WHERE source=$1 AND picking_id=$2 AND order_id=$3 FOR UPDATE`,
    key,
  );
  if (!rows[0] || Number(rows[0].partner_id) !== target.partnerId)
    throw new AppError("FINANCIAL_IDENTITY_CHANGED", 409);
  const hash = financialHash(snapshot);
  const changed = rows[0].content_hash !== hash;
  const revision = rows[0].revision + (changed ? 1 : 0);
  if (changed) {
    await client.query(
      `INSERT INTO route_financial_revisions(source,picking_id,order_id,revision,content_hash,snapshot)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [...key, revision, hash, JSON.stringify(snapshot)],
    );
    await audit(
      client,
      null,
      "financial.source_observed",
      `${target.pickingId}:${target.orderId}`,
      {
        source: target.source,
        revision,
        contentHash: hash,
        status: snapshot.status,
        reasons: snapshot.reasons,
      },
    );
  }
  await client.query(
    `UPDATE route_financial_targets SET revision=$4,content_hash=$5,last_checked_at=now(),last_success_at=now(),
    last_error=NULL,failures=0,attempts=attempts+1,last_duration_ms=$6,next_attempt_at=now()+make_interval(secs=>$7)
    WHERE source=$1 AND picking_id=$2 AND order_id=$3`,
    [...key, revision, hash, durationMs, pollSeconds],
  );
  return { revision, changed };
}

/** Existing administrative capability only. Mobile composition is introduced with block 2. */
export async function readShipmentFinancials(
  pool: Pool,
  actor: string,
  shipmentId: string,
) {
  const id = uuid(shipmentId);
  return transaction(pool, async (client) => {
    await assertActiveActor(client, actor);
    const result = await client.query(
      `SELECT t.revision,t.last_checked_at,t.last_success_at,t.last_error,t.next_attempt_at,
      t.failures,t.last_duration_ms,r.snapshot,r.observed_at,
      EXTRACT(EPOCH FROM now()-t.last_success_at) AS age_seconds
      FROM route_shipments s JOIN route_financial_targets t ON (t.source,t.picking_id,t.order_id)=(s.source,s.picking_id,s.order_id)
      LEFT JOIN route_financial_revisions r ON (r.source,r.picking_id,r.order_id,r.revision)=(t.source,t.picking_id,t.order_id,t.revision)
      WHERE s.id=$1`,
      [id],
    );
    if (!result.rows[0]) throw new AppError("NOT_FOUND", 404);
    return result.rows[0] as {
      revision: number;
      last_checked_at: Date | null;
      last_success_at: Date | null;
      last_error: string | null;
      next_attempt_at: Date;
      failures: number;
      last_duration_ms: number | null;
      snapshot: FinancialSnapshot | null;
      observed_at: Date | null;
      age_seconds: string | null;
    };
  });
}
