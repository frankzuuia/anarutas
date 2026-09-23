import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { Pool } from "pg";
import sharp from "sharp";
import { assertActiveActor, transaction, type Sql } from "./database";
import { AppError } from "./errors";
import { todayInTimezone } from "./local-date";
import { uuid } from "./orders-validation";

const maxInputBytes = 8 * 1024 * 1024;
const maxStoredBytes = 1_572_864;
const formats: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function unitPhotoRoot(raw = process.env.RUTAS_UNIT_PHOTO_DIR) {
  if (!raw?.trim() || !isAbsolute(raw.trim()))
    throw new AppError("UNIT_PHOTO_STORAGE_UNAVAILABLE", 503);
  const path = resolve(raw.trim());
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("directory");
  } catch {
    throw new AppError("UNIT_PHOTO_STORAGE_UNAVAILABLE", 503);
  }
  return path;
}

export async function sanitizeUnitPhoto(data: Buffer, contentType: string) {
  if (!data.length || data.length > maxInputBytes)
    throw new AppError("UNIT_PHOTO_TOO_LARGE", 413);
  if (!Object.hasOwn(formats, contentType))
    throw new AppError("UNIT_PHOTO_INVALID", 415);
  try {
    const image = sharp(data, { limitInputPixels: 20_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== formats[contentType] || (metadata.pages ?? 1) !== 1)
      throw new Error("format");
    const encoded = await image
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78, effort: 5 })
      .timeout({ seconds: 15 })
      .toBuffer();
    if (!encoded.length || encoded.length > maxStoredBytes)
      throw new AppError("UNIT_PHOTO_TOO_LARGE", 413);
    return encoded;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("UNIT_PHOTO_INVALID", 415);
  }
}

type PhotoRow = {
  id: string;
  plan_id: string;
  vehicle_id: string;
  driver_id: string;
  storage_key: string;
  created_at: Date;
  expires_at: Date;
  bytes: number;
};

function publicPhoto(row: PhotoRow) {
  return {
    id: row.id,
    planId: row.plan_id,
    vehicleId: row.vehicle_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    bytes: row.bytes,
  };
}

async function assertPublishedDriver(sql: Sql, planId: string, driverId: string) {
  const { rows } = await sql.query(
    `SELECT pub.vehicle_id,pub.started_at
       FROM route_plan_publications pub
       JOIN route_plan_vehicles pv ON pv.plan_id=pub.plan_id AND pv.vehicle_id=pub.vehicle_id
       JOIN route_vehicles v ON v.id=pub.vehicle_id
       JOIN route_drivers d ON d.id=pub.driver_id
      WHERE pub.plan_id=$1 AND d.active AND (
        (pub.started_at IS NOT NULL AND pub.started_driver_id=$2 AND pv.driver_id=$2)
        OR (pub.started_at IS NULL AND pub.driver_id=$2 AND pv.driver_id=$2
            AND v.driver_id=$2 AND v.available)
      )
      FOR UPDATE OF pub`,
    [planId, driverId],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", 404);
  return rows[0] as { vehicle_id: string; started_at: Date | null };
}

export async function listDriverUnitPhotos(
  pool: Pool,
  driverId: string,
  planId: string,
  timezone: string,
) {
  return transaction(pool, async (sql) => {
    const id = uuid(planId);
    const plan = await sql.query("SELECT service_date::text FROM route_plans WHERE id=$1 FOR SHARE", [id]);
    const publication = await assertPublishedDriver(sql, id, driverId);
    const { rows } = await sql.query(
      `SELECT id,plan_id,vehicle_id,driver_id,storage_key,created_at,expires_at,bytes
         FROM route_unit_photos WHERE plan_id=$1 AND vehicle_id=$2 AND driver_id=$3
           AND (created_at AT TIME ZONE $4)::date=$5::date AND expires_at>now()
         ORDER BY created_at,id`,
      [id, publication.vehicle_id, driverId, timezone, plan.rows[0].service_date],
    );
    return rows.map((row) => publicPhoto(row as PhotoRow));
  });
}

export async function uploadDriverUnitPhoto(
  pool: Pool,
  driverId: string,
  planId: string,
  data: Buffer,
  contentType: string,
  timezone: string,
  configuredRoot?: string,
  capturedAt = new Date(),
) {
  const id = uuid(planId);
  const bytes = await sanitizeUnitPhoto(data, contentType);
  const root = await unitPhotoRoot(configuredRoot);
  const photoId = randomUUID();
  const storageKey = `${photoId}.webp`;
  const location = join(root, storageKey);
  const hash = createHash("sha256").update(bytes).digest("hex");
  try {
    await writeFile(location, bytes, { flag: "wx", mode: 0o600 });
  } catch {
    throw new AppError("UNIT_PHOTO_STORAGE_UNAVAILABLE", 503);
  }
  let kept = false;
  try {
    const saved = await transaction(pool, async (sql) => {
      const plan = await sql.query("SELECT service_date::text FROM route_plans WHERE id=$1 FOR SHARE", [id]);
      const publication = await assertPublishedDriver(sql, id, driverId);
      if (publication.started_at) throw new AppError("ROUTE_ALREADY_STARTED", 409);
      if (plan.rows[0].service_date !== todayInTimezone(timezone, capturedAt))
        throw new AppError("ROUTE_DATE_MISMATCH", 409);
      // Serialize the same vehicle across different plans before testing its active hash.
      await sql.query(
        "SELECT pg_advisory_xact_lock(hashtext('ana-rutas:unit-photo'),hashtext($1::text))",
        [publication.vehicle_id],
      );
      const existing = await sql.query(
        `SELECT id,plan_id,vehicle_id,driver_id,storage_key,created_at,expires_at,bytes
         FROM route_unit_photos WHERE vehicle_id=$1 AND content_hash=$2
           AND expires_at>now()`,
        [publication.vehicle_id, hash],
      );
      if (existing.rows[0]) {
        const priorPhotos = existing.rows as PhotoRow[];
        const reused = priorPhotos.some((prior) =>
          prior.plan_id !== id || prior.driver_id !== driverId ||
          todayInTimezone(timezone, prior.created_at) !== plan.rows[0].service_date,
        );
        if (reused) throw new AppError("UNIT_PHOTO_REUSED", 409);
        return { ...publicPhoto(priorPhotos[0]), duplicate: true };
      }
      const count = await sql.query(
        `SELECT count(*)::integer AS n FROM route_unit_photos
         WHERE plan_id=$1 AND vehicle_id=$2 AND driver_id=$3
           AND (created_at AT TIME ZONE $4)::date=$5::date AND expires_at>now()`,
        [id, publication.vehicle_id, driverId, timezone, plan.rows[0].service_date],
      );
      if (Number(count.rows[0].n) >= 8)
        throw new AppError("UNIT_PHOTO_LIMIT", 409);
      const inserted = await sql.query(
        `INSERT INTO route_unit_photos(id,plan_id,vehicle_id,driver_id,storage_key,content_hash,bytes,created_at,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$8::timestamptz+interval '15 days')
         ON CONFLICT(plan_id,vehicle_id,driver_id,content_hash) DO UPDATE SET
           id=EXCLUDED.id,driver_id=EXCLUDED.driver_id,
           storage_key=EXCLUDED.storage_key,bytes=EXCLUDED.bytes,
           created_at=EXCLUDED.created_at,expires_at=EXCLUDED.expires_at
         WHERE route_unit_photos.expires_at<=now()
            OR (route_unit_photos.created_at AT TIME ZONE $9)::date<>$10::date
         RETURNING id,plan_id,vehicle_id,driver_id,storage_key,created_at,expires_at,bytes`,
        [photoId, id, publication.vehicle_id, driverId, storageKey, hash, bytes.length,
          capturedAt.toISOString(), timezone, plan.rows[0].service_date],
      );
      if (!inserted.rowCount) throw new AppError("UNIT_PHOTO_LIMIT", 409);
      await sql.query(
        `INSERT INTO route_driver_mobile_audit(driver_id,action,details)
         VALUES($1,'mobile.unit_photo.saved',$2::jsonb)`,
        [driverId, JSON.stringify({ planId: id, vehicleId: publication.vehicle_id, photoId })],
      );
      return { ...publicPhoto(inserted.rows[0] as PhotoRow), duplicate: false };
    });
    kept = !saved.duplicate;
    return saved;
  } finally {
    if (!kept) await unlink(location).catch(() => undefined);
  }
}

export async function readDriverUnitPhoto(
  pool: Pool,
  driverId: string,
  photoId: string,
  configuredRoot?: string,
) {
  const id = uuid(photoId);
  const { rows } = await pool.query(
    `SELECT p.storage_key FROM route_unit_photos p
     JOIN route_plan_publications pub ON pub.plan_id=p.plan_id AND pub.vehicle_id=p.vehicle_id
     JOIN route_plan_vehicles pv ON pv.plan_id=pub.plan_id AND pv.vehicle_id=pub.vehicle_id
     JOIN route_vehicles v ON v.id=pub.vehicle_id
     JOIN route_drivers d ON d.id=pub.driver_id
     WHERE p.id=$1 AND p.expires_at>now() AND p.driver_id=$2 AND d.active AND (
       (pub.started_at IS NOT NULL AND pub.started_driver_id=$2 AND pv.driver_id=$2)
       OR (pub.started_at IS NULL AND pub.driver_id=$2 AND pv.driver_id=$2
           AND v.driver_id=$2 AND v.available)
     )`,
    [id, driverId],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", 404);
  const root = await unitPhotoRoot(configuredRoot);
  return readFile(join(root, `${id}.webp`)).catch(() => {
    throw new AppError("UNIT_PHOTO_STORAGE_UNAVAILABLE", 503);
  });
}

export async function listAdminUnitPhotos(
  pool: Pool,
  actorId: string,
  vehicleId: string,
  date: string,
  timezone: string,
) {
  const id = uuid(vehicleId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
    throw new AppError("INVALID_INPUT");
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actorId);
    const vehicle = await sql.query("SELECT id FROM route_vehicles WHERE id=$1", [id]);
    if (!vehicle.rowCount) throw new AppError("FLEET_NOT_FOUND", 404);
    const { rows } = await sql.query(
      `SELECT photo.id,photo.plan_id,photo.vehicle_id,photo.driver_id,
              photo.storage_key,photo.created_at,photo.expires_at,photo.bytes,
              COALESCE(pub.snapshot->'plan'->>'label',plan.label) AS plan_label,
              plan.service_date::text AS service_date
         FROM route_unit_photos photo
         JOIN route_plans plan ON plan.id=photo.plan_id
         LEFT JOIN route_plan_publications pub
           ON pub.plan_id=photo.plan_id AND pub.vehicle_id=photo.vehicle_id
        WHERE photo.vehicle_id=$1
          AND (photo.created_at AT TIME ZONE $3)::date=$2::date
          AND photo.expires_at>now()
        ORDER BY photo.created_at DESC,photo.id DESC`,
      [id, date, timezone],
    );
    return rows.map((row) => ({
      ...publicPhoto(row as PhotoRow),
      planLabel: String(row.plan_label),
      serviceDate: String(row.service_date),
    }));
  });
}

export async function readAdminUnitPhoto(
  pool: Pool,
  actorId: string,
  photoId: string,
  configuredRoot?: string,
) {
  const id = uuid(photoId);
  await assertActiveActor(pool, actorId);
  const { rows } = await pool.query(
    "SELECT storage_key FROM route_unit_photos WHERE id=$1 AND expires_at>now()",
    [id],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", 404);
  const root = await unitPhotoRoot(configuredRoot);
  return readFile(join(root, `${id}.webp`)).catch(() => {
    throw new AppError("UNIT_PHOTO_STORAGE_UNAVAILABLE", 503);
  });
}

export async function cleanExpiredUnitPhotos(pool: Pool, configuredRoot?: string) {
  const root = await unitPhotoRoot(configuredRoot);
  const { rows } = await pool.query(
    `DELETE FROM route_unit_photos WHERE id IN (
       SELECT id FROM route_unit_photos WHERE expires_at<=now()
       ORDER BY expires_at,id LIMIT 200
     ) RETURNING storage_key`,
  );
  for (const row of rows) await unlink(join(root, row.storage_key)).catch(() => undefined);
  const cutoff = Date.now() - (15 * 24 + 1) * 60 * 60 * 1000;
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (!item.isFile() || !/^[0-9a-f-]{36}\.webp$/.test(item.name)) continue;
    const path = join(root, item.name);
    const info = await lstat(path).catch(() => null);
    if (info?.isFile() && info.mtimeMs < cutoff)
      await unlink(path).catch(() => undefined);
  }
  return rows.length;
}
