import type { Pool } from "pg";
import { authenticateMobile } from "./driver-mobile-auth";
import { assertActiveActor, transaction } from "./database";
import { storeIncidentEvidence, readStoredIncidentEvidence } from "./driver-incident-evidence";
import { reportProductIncident } from "./product-incidents";
import { uuid } from "./orders-validation";
import { AppError } from "./errors";

export async function reportProductIncidentWithEvidence(pool: Pool, authorization: string | null, planId: string,
  stopId: string, shipmentId: string, raw: Record<string, unknown>, timezone: string,
  bytes: Buffer, contentType: string, configuredRoot?: string, at = new Date()) {
  await authenticateMobile(pool, authorization);
  const evidence = await storeIncidentEvidence(bytes, contentType, configuredRoot);
  let kept = false;
  try {
    const result = await reportProductIncident(pool, authorization, planId, stopId, shipmentId, raw, timezone, at, evidence);
    kept = !result.duplicate;
    return result;
  } finally {
    if (!kept) {
      // A lost COMMIT response is not proof of rollback. Keep a referenced file;
      // if the database is unreachable, the existing orphan worker decides later.
      try {
        const referenced = await pool.query("SELECT 1 FROM route_product_incidents WHERE evidence_id=$1", [evidence.id]);
        if (!referenced.rowCount) await evidence.discard();
      } catch { /* preserve evidence on an uncertain database outcome */ }
    }
  }
}

export async function readProductIncidentEvidence(pool: Pool, actor: string, incidentId: string, configuredRoot?: string) {
  const id = uuid(incidentId);
  return transaction(pool, async sql => {
    await assertActiveActor(sql, actor);
    const row = (await sql.query("SELECT evidence_id FROM route_product_incidents WHERE id=$1 FOR SHARE", [id])).rows[0];
    if (!row?.evidence_id) throw new AppError("NOT_FOUND", 404);
    return readStoredIncidentEvidence(row.evidence_id, configuredRoot);
  });
}
