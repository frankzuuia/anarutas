import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rmdir, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { migrate, transaction } from "../src/core/database";
import { migrateUnitPhotoRetention } from "../src/core/unit-photo-retention-schema";
import { cleanExpiredUnitPhotos, readAdminUnitPhoto, readDriverUnitPhoto, uploadDriverUnitPhoto } from "../src/core/unit-photos";
import { cleanIncidentEvidence, storeIncidentEvidence } from "../src/core/driver-incident-evidence";
import { UnitPhotoCleanup } from "../src/server/unit-photo-cleanup";

const day = 86_400_000;
let f: Awaited<ReturnType<typeof executionFixture>>;
let image: Buffer;
beforeAll(async () => {
  f = await executionFixture({ now: new Date() });
  image = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#579" } }).jpeg().toBuffer();
});
afterAll(async () => f?.close());
beforeEach(async () => {
  await f.db.pool.query("DELETE FROM route_unit_photos");
  for (const entry of await readdir(f.photoRoot, { withFileTypes: true })) {
    if (entry.isFile()) await unlink(join(f.photoRoot, entry.name));
  }
});

const upload = () => uploadDriverUnitPhoto(f.db.pool, f.members[0].driverId, f.planId, image,
  "image/jpeg", f.timezone, f.photoRoot, f.now);

// Actual PostgreSQL rows and private files, with controlled timestamps as boundary fixtures.
async function storedPhoto(ageDays: number, expiryDays = 30) {
  const id = randomUUID(), path = join(f.photoRoot, `${id}.webp`);
  await writeFile(path, await sharp(image).webp().toBuffer());
  const row = (await f.db.pool.query(`INSERT INTO route_unit_photos
    (id,plan_id,vehicle_id,driver_id,storage_key,content_hash,bytes,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now()-($8::integer*interval '1 day'),
      now()+(($9::integer-$8::integer)*interval '1 day')) RETURNING *`,
  [id, f.planId, f.members[0].vehicleId, f.members[0].driverId, `${id}.webp`,
    id.replaceAll("-", "").repeat(2), (await lstat(path)).size, ageDays, expiryDays])).rows[0];
  return { id, path, row };
}

describe("unit photos: thirty-day retention and independent daily cleanup", () => {
  it("uploads with thirty days from capture and retries without extending expiry or leaking another driver's photo", async () => {
    const photo = await upload();
    expect(photo.expiresAt.getTime() - photo.createdAt.getTime()).toBe(30 * day);
    const retry = await upload();
    expect(retry).toMatchObject({ id: photo.id, duplicate: true, expiresAt: photo.expiresAt });
    await expect(readDriverUnitPhoto(f.db.pool, f.members[1].driverId, photo.id, f.photoRoot))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await readDriverUnitPhoto(f.db.pool, f.members[0].driverId, photo.id, f.photoRoot)).length).toBeGreaterThan(0);
  });

  it("migrates surviving legacy photos from their capture date, concurrently and idempotently", async () => {
    const active = await storedPhoto(10, 15);
    const surviving = await storedPhoto(20, 15);
    const pastThirty = await storedPhoto(31, 15);
    const custom = await storedPhoto(10, 3);
    const bytes = await readFile(surviving.path);
    await f.db.pool.query(`ALTER TABLE route_unit_photos ALTER COLUMN expires_at SET DEFAULT (now()+interval '15 days');
      UPDATE rutas_installation SET schema_version=43`);
    await Promise.all([migrate(f.db.pool, f.db.config.instanceId), migrate(f.db.pool, f.db.config.instanceId)]);
    await migrate(f.db.pool, f.db.config.instanceId);
    expect((await f.db.pool.query("SELECT schema_version FROM rutas_installation")).rows[0].schema_version).toBe(46);
    for (const photo of [active, surviving, pastThirty]) {
      const after = (await f.db.pool.query("SELECT * FROM route_unit_photos WHERE id=$1", [photo.id])).rows[0];
      expect(after).toEqual({ ...photo.row, expires_at: new Date(photo.row.created_at.getTime() + 30 * day) });
    }
    expect((await f.db.pool.query("SELECT * FROM route_unit_photos WHERE id=$1", [custom.id])).rows[0]).toEqual(custom.row);
    expect(await readAdminUnitPhoto(f.db.pool, f.actor, surviving.id, f.photoRoot)).toEqual(bytes);
    await expect(readAdminUnitPhoto(f.db.pool, f.actor, pastThirty.id, f.photoRoot)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("applies the thirty-day database default when expiry is omitted", async () => {
    const id = randomUUID();
    const row = (await f.db.pool.query(`INSERT INTO route_unit_photos
      (id,plan_id,vehicle_id,driver_id,storage_key,content_hash,bytes)
      VALUES($1,$2,$3,$4,$5,$6,1) RETURNING created_at,expires_at`,
    [id, f.planId, f.members[0].vehicleId, f.members[0].driverId, `${id}.webp`, id.replaceAll("-", "").repeat(2)])).rows[0];
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(30 * day);
  });

  it("rolls back expiry and schema together if migration fails", async () => {
    const legacy = await storedPhoto(10, 15);
    await f.db.pool.query("UPDATE rutas_installation SET schema_version=43");
    await expect(transaction(f.db.pool, async sql => {
      await migrateUnitPhotoRetention(sql);
      await sql.query("SELECT 1 / 0");
    })).rejects.toMatchObject({ code: "22012" });
    expect((await f.db.pool.query("SELECT * FROM route_unit_photos WHERE id=$1", [legacy.id])).rows[0]).toEqual(legacy.row);
    expect((await f.db.pool.query("SELECT schema_version FROM rutas_installation")).rows[0].schema_version).toBe(43);
    await migrate(f.db.pool, f.db.config.instanceId);
  });

  it("keeps a 29-day photo despite an old file timestamp and removes only old unit-photo orphans", async () => {
    const active = await storedPhoto(29);
    const old = new Date(Date.now() - 45 * day);
    await utimes(active.path, old, old);
    const youngOrphan = join(f.photoRoot, `${randomUUID()}.webp`);
    const oldOrphan = join(f.photoRoot, `${randomUUID()}.webp`);
    const unrelated = join(f.photoRoot, "driver-document.webp");
    for (const path of [youngOrphan, oldOrphan, unrelated]) await writeFile(path, image);
    const young = new Date(Date.now() - 16 * day);
    await utimes(youngOrphan, young, young);
    await utimes(oldOrphan, old, old);
    await utimes(unrelated, old, old);
    expect(await cleanExpiredUnitPhotos(f.db.pool, f.photoRoot)).toBe(0);
    expect((await readAdminUnitPhoto(f.db.pool, f.actor, active.id, f.photoRoot)).length).toBeGreaterThan(0);
    expect(await readFile(youngOrphan)).toEqual(image);
    expect(await readFile(unrelated)).toEqual(image);
    await expect(lstat(oldOrphan)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("denies access at expiry even before the daily sweep runs", async () => {
    const expired = await storedPhoto(30);
    await expect(readAdminUnitPhoto(f.db.pool, f.actor, expired.id, f.photoRoot)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readDriverUnitPhoto(f.db.pool, f.members[0].driverId, expired.id, f.photoRoot)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await lstat(expired.path)).isFile()).toBe(true);
    expect(await cleanExpiredUnitPhotos(f.db.pool, f.photoRoot)).toBe(1);
    await expect(lstat(expired.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("drains more than one batch without duplicate claims across concurrent cleaners", async () => {
    await f.db.pool.query(`INSERT INTO route_unit_photos
      (id,plan_id,vehicle_id,driver_id,storage_key,content_hash,bytes,created_at,expires_at)
      SELECT id,$1,$2,$3,id::text||'.webp',repeat(replace(id::text,'-',''),2),1,
        now()-interval '31 days',now()-interval '1 day'
      FROM (SELECT gen_random_uuid() AS id FROM generate_series(1,405)) entries`,
    [f.planId, f.members[0].vehicleId, f.members[0].driverId]);
    const counts = await Promise.all([cleanExpiredUnitPhotos(f.db.pool, f.photoRoot), cleanExpiredUnitPhotos(f.db.pool, f.photoRoot)]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(405);
    expect((await f.db.pool.query("SELECT id FROM route_unit_photos")).rowCount).toBe(0);
  });

  it("retries an orphan after a real unlink failure", async () => {
    const expired = await storedPhoto(31);
    await unlink(expired.path);
    await mkdir(expired.path); // unlink cannot remove a directory; no filesystem mock.
    expect(await cleanExpiredUnitPhotos(f.db.pool, f.photoRoot)).toBe(1);
    expect((await lstat(expired.path)).isDirectory()).toBe(true);
    await rmdir(expired.path);
    await writeFile(expired.path, image);
    const old = new Date(Date.now() - 31 * day);
    await utimes(expired.path, old, old);
    expect(await cleanExpiredUnitPhotos(f.db.pool, f.photoRoot)).toBe(0);
    await expect(lstat(expired.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("skips hourly sweeps and resumes at exactly 24 hours, without unit storage I/O in between", async () => {
    const task = new UnitPhotoCleanup(), now = Date.now();
    expect(await task.runIfDue(f.db.pool, f.photoRoot, now)).toBe(0);
    const expired = await storedPhoto(31);
    const unavailableRoot = join(f.photoRoot, "missing");
    for (const elapsed of [60_000, 3_600_000, day - 1]) {
      expect(await task.runIfDue(f.db.pool, unavailableRoot, now + elapsed)).toBeNull();
    }
    expect((await lstat(expired.path)).isFile()).toBe(true);
    expect(await task.runIfDue(f.db.pool, f.photoRoot, now + day)).toBe(1);
    await expect(lstat(expired.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retries failed storage and excludes overlapping daily runs", async () => {
    const task = new UnitPhotoCleanup(), now = Date.now();
    await expect(task.runIfDue(f.db.pool, join(f.photoRoot, "missing"), now))
      .rejects.toMatchObject({ code: "UNIT_PHOTO_STORAGE_UNAVAILABLE" });
    await storedPhoto(31);
    const counts = await Promise.all([
      task.runIfDue(f.db.pool, f.photoRoot, now + 60_000),
      task.runIfDue(f.db.pool, f.photoRoot, now + 60_000),
    ]);
    expect(counts).toEqual([1, null]);
  });

  it("leaves incident evidence to its own cleaner while the unit cleaner is waiting", async () => {
    const task = new UnitPhotoCleanup(), now = Date.now();
    expect(await task.runIfDue(f.db.pool, f.photoRoot, now)).toBe(0);
    const evidence = await storeIncidentEvidence(image, "image/jpeg", f.photoRoot);
    const path = join(f.photoRoot, "incident-evidence", evidence.storageKey);
    const old = new Date(now - 45 * day);
    await utimes(path, old, old);
    await cleanExpiredUnitPhotos(f.db.pool, f.photoRoot);
    expect((await lstat(path)).isFile()).toBe(true);
    expect(await task.runIfDue(f.db.pool, f.photoRoot, now + 60_000)).toBeNull();
    await cleanIncidentEvidence(f.db.pool, f.photoRoot);
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
