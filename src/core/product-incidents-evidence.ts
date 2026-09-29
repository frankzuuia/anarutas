import type { Pool } from "pg";
import { authenticateMobile } from "./driver-mobile-auth";
import { assertActiveActor, transaction } from "./database";
import { storeIncidentEvidence, readStoredIncidentEvidence } from "./driver-incident-evidence";
import { reportProductIncident } from "./product-incidents";
import { uuid } from "./orders-validation";
import { AppError } from "./errors";
import { productPhotoCount } from "./product-incident-form";

export async function reportProductIncidentWithEvidence(pool: Pool, authorization: string | null, planId: string,
  stopId: string, shipmentId: string, raw: Record<string, unknown>, timezone: string,
  bytes: Buffer, contentType: string, configuredRoot?: string, at = new Date()) {
  return reportProductIncidentWithPhotos(pool, authorization, planId, stopId, shipmentId, raw, timezone,
    [{ bytes, contentType }], configuredRoot, at);
}

export async function reportProductIncidentWithPhotos(pool: Pool, authorization: string | null, planId: string,
  stopId: string, shipmentId: string, raw: Record<string, unknown>, timezone: string,
  photos: { bytes: Buffer; contentType: string }[], configuredRoot?: string, at = new Date()) {
  await authenticateMobile(pool, authorization);
  productPhotoCount(photos.length);
  const stored: Awaited<ReturnType<typeof storeIncidentEvidence>>[] = [];
  let kept = false;
  try {
    for (const photo of photos) stored.push(await storeIncidentEvidence(photo.bytes, photo.contentType, configuredRoot));
    const result = await reportProductIncident(pool, authorization, planId, stopId, shipmentId, raw, timezone, at, stored[0], stored.slice(1));
    kept = !result.duplicate;
    return result;
  } finally {
    if (!kept) for (const evidence of stored) {
      // A lost COMMIT response is not proof of rollback. Keep a referenced file;
      // if the database is unreachable, the existing orphan worker decides later.
      try {
        const referenced = await pool.query(`SELECT 1 FROM route_product_incidents WHERE evidence_id=$1
          UNION ALL SELECT 1 FROM route_product_incident_photos WHERE evidence_id=$1`, [evidence.id]);
        if (!referenced.rowCount) await evidence.discard();
      } catch { /* preserve evidence on an uncertain database outcome */ }
    }
  }
}

export async function readProductIncidentEvidence(pool: Pool, actor: string, incidentId: string, configuredRoot?: string, photoId?: string | null) {
  const id = uuid(incidentId);
  const requested = photoId == null ? null : uuid(photoId);
  return transaction(pool, async sql => {
    await assertActiveActor(sql, actor);
    const row = (await sql.query("SELECT evidence_id FROM route_product_incidents WHERE id=$1 FOR SHARE", [id])).rows[0];
    if (!row?.evidence_id) throw new AppError("NOT_FOUND", 404);
    if (requested && requested !== row.evidence_id && !(await sql.query(
      "SELECT 1 FROM route_product_incident_photos WHERE incident_id=$1 AND evidence_id=$2", [id, requested])).rowCount)
      throw new AppError("NOT_FOUND", 404);
    return readStoredIncidentEvidence(requested ?? row.evidence_id, configuredRoot);
  });
}
