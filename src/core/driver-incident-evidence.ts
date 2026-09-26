import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { assertActiveActor, transaction } from "./database";
import { unitPhotoRoot, sanitizeUnitPhoto } from "./unit-photos";
import { AppError } from "./errors";
import { uuid } from "./orders-validation";

async function evidenceRoot(configuredRoot?: string) {
  const root = join(await unitPhotoRoot(configuredRoot), "incident-evidence");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new AppError("UNIT_PHOTO_STORAGE_UNAVAILABLE", 503);
  return root;
}

export async function storeIncidentEvidence(data: Buffer, contentType: string, configuredRoot?: string) {
  const bytes = await sanitizeUnitPhoto(data, contentType);
  const root = await evidenceRoot(configuredRoot), id = randomUUID();
  const storageKey = `${id}.webp`, path = join(root, storageKey);
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  return { id, storageKey, bytes: bytes.length,
    hash: createHash("sha256").update(bytes).digest("hex"),
    discard: () => unlink(path).catch(() => undefined) };
}

export async function readIncidentEvidence(pool: Pool, actorId: string, evidenceId: string,
  configuredRoot?: string, now = new Date()) {
  const id = uuid(evidenceId);
  return transaction(pool, async sql => {
    await assertActiveActor(sql, actorId);
    const row = (await sql.query(`SELECT id FROM route_driver_incident_evidence
      WHERE id=$1 AND expires_at>$2 AND revoked_at IS NULL AND removed_at IS NULL FOR SHARE`, [id, now])).rows[0];
    if (!row) throw new AppError("NOT_FOUND", 404);
    const path = join(await evidenceRoot(configuredRoot), `${id}.webp`);
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) throw new AppError("NOT_FOUND", 404);
    return readFile(path);
  });
}

// Expiry is enforced on every read even if the worker was offline. Deletion is
// retried until the file is gone; metadata and audit are never erased.
export async function cleanIncidentEvidence(pool: Pool, configuredRoot?: string, now = new Date()) {
  const root = await evidenceRoot(configuredRoot);
  const removed = await transaction(pool, async sql => {
    const rows = (await sql.query(`SELECT id,incident_id FROM route_driver_incident_evidence
      WHERE removed_at IS NULL AND (expires_at<=$1 OR revoked_at IS NOT NULL)
      ORDER BY expires_at,id LIMIT 200 FOR UPDATE SKIP LOCKED`, [now])).rows;
    let count = 0;
    for (const row of rows) {
      try { await unlink(join(root, `${uuid(row.id)}.webp`)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue; }
      await sql.query("UPDATE route_driver_incident_evidence SET removed_at=$2 WHERE id=$1", [row.id, now]);
      await sql.query(`INSERT INTO route_driver_incident_events(id,incident_id,kind,actor_type,occurred_at,details)
        VALUES($1,$2,'evidence_expired','system',$3,$4)`,
      [randomUUID(), row.incident_id, now, JSON.stringify({ evidenceId: row.id })]);
      count++;
    }
    return count;
  });
  // A crash between filesystem write and DB commit can leave an unreferenced
  // file. Only old generated files in this dedicated, validated directory qualify.
  for (const file of await readdir(root, { withFileTypes: true })) {
    if (!file.isFile() || !/^[0-9a-f-]{36}\.webp$/.test(file.name)) continue;
    const path = join(root, file.name), info = await lstat(path).catch(() => null);
    if (!info?.isFile() || info.mtimeMs > now.getTime() - 24 * 60 * 60 * 1000) continue;
    const referenced = await pool.query("SELECT 1 FROM route_driver_incident_evidence WHERE storage_key=$1", [file.name]);
    if (!referenced.rowCount) await unlink(path).catch(() => undefined);
  }
  return removed;
}

export async function tryCleanIncidentEvidence(pool: Pool) {
  try { await cleanIncidentEvidence(pool); }
  catch { console.warn(JSON.stringify({ event: "incident_evidence.cleanup_deferred" })); }
}
