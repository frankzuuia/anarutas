import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, it } from "vitest";
import { ProductThumbnailCache } from "../src/core/product-thumbnail-cache";
import { normalizeProductThumbnail, readDriverProductThumbnail, resolveDriverProductThumbnail } from "../src/core/product-thumbnails";
import { readDriverPlan } from "../src/core/driver-mobile-route";
import { readProductThumbnails } from "../src/core/odoo";
import { readOdooConfig } from "../src/core/config";
import { cancelPublishedRoute } from "../src/core/route-publications";
import { executionFixture } from "./helpers/driver-execution";

it("normalizes actual image bytes and rejects invalid, oversized and non-image values", async () => {
  const png = await sharp({ create: { width: 256, height: 100, channels: 4, background: "#aaff0055" } }).png().toBuffer();
  const normalized = await normalizeProductThumbnail(png.toString("base64"));
  expect(normalized).not.toBeNull();
  expect(await sharp(normalized!).metadata()).toMatchObject({ format: "webp", width: 128, height: 50 });
  for (const value of [false, null, undefined, 42, "", "@@@@", "a".repeat(180_001), Buffer.from("not an image").toString("base64")])
    expect(await normalizeProductThumbnail(value)).toBeNull();
  const excessive = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#fff" } }).png().toBuffer();
  expect(await normalizeProductThumbnail(excessive.toString("base64"))).toBeNull();
});

it("deduplicates pending batches, caches missing pictures, refreshes on expiry and isolates scopes", async () => {
  let now = 0, loads = 0;
  const cache = new ProductThumbnailCache(() => now);
  const images = new Map([[1, Buffer.from("image")], [2, null]]);
  const load = async () => { loads++; return images; };
  expect(await Promise.all(Array.from({ length: 13 }, () => cache.get("scope-a", load))))
    .toEqual(Array.from({ length: 13 }, () => images));
  expect(loads).toBe(1);
  now = 899_999; expect(await cache.get("scope-a", load)).toBe(images); expect(loads).toBe(1);
  now++; await cache.get("scope-a", load); expect(loads).toBe(2);
  await cache.get("scope-b", load); expect(loads).toBe(3);
});

it("bounds cache entries/bytes and retries failures after a shared cooldown", async () => {
  let now = 0, loads = 0;
  const cache = new ProductThumbnailCache(() => now, 2, 6);
  const load = async () => { loads++; return new Map([[1, Buffer.alloc(3)]]); };
  await cache.get("a", load); await cache.get("b", load); await cache.get("a", load); await cache.get("c", load);
  expect(loads).toBe(3);
  await cache.get("b", load); expect(loads).toBe(4);
  await cache.get("big", async () => new Map([[1, Buffer.alloc(7)]]));
  await cache.get("b", load); expect(loads).toBe(5);
  const fail = async (): Promise<Map<number, Buffer | null>> => { loads++; throw new Error("unavailable"); };
  await expect(cache.get("failure", fail)).rejects.toThrow("unavailable");
  now = 29_999; await expect(cache.get("failure", fail)).rejects.toThrow("unavailable"); expect(loads).toBe(6);
  now++; await cache.get("failure", load); expect(loads).toBe(7);
});

it("authorizes existing publications and preserves all route/order data while deriving thumbnail references", async () => {
  const f = await executionFixture({ secondLinePerOrder: true });
  try {
    const [driver, other] = f.members;
    const before = (await f.db.pool.query("SELECT * FROM route_plan_publications ORDER BY vehicle_id")).rows;
    const plan = await readDriverPlan(f.db.pool, driver.driverId, f.planId, f.timezone);
    const order = plan.orders[0];
    expect(order.lines[0].thumbnailPath).toBe(`/api/mobile/plans/${f.planId}/orders/${order.id}/lines/0/thumbnail?revision=1`);
    const resolve = (shipment = order.id, index = 0, revision = 1, actor = driver.driverId) =>
      resolveDriverProductThumbnail(f.db.pool, actor, f.planId, shipment, index, revision, f.timezone);
    expect(await resolve()).toMatchObject({ productId: 1, productIds: [1, 11] });
    expect(await resolve(order.id, 1)).toMatchObject({ productId: 11, productIds: [1, 11] });
    await expect(resolve(order.id, 0, 1, other.driverId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(resolve(randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(resolve(order.id, 2)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(resolve(order.id, -1)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(resolve(order.id, 0, 2)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(resolve(order.id, 0, 0)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const original = (await f.db.pool.query("SELECT snapshot FROM route_shipments WHERE id=$1", [order.id])).rows[0].snapshot;
    for (const change of [{ name: "Another product" }, { quantity: 999 }, { unit: "box" }]) {
      await f.db.pool.query("UPDATE route_shipments SET snapshot=$2 WHERE id=$1",
        [order.id, { ...original, lines: [{ ...original.lines[0], ...change }, original.lines[1]] }]);
      expect(await resolve()).toBeNull();
      expect(await resolve(order.id, 1)).toBeNull();
    }
    await f.db.pool.query("UPDATE route_shipments SET snapshot=$2 WHERE id=$1", [order.id, { ...original, lines: [] }]);
    expect(await resolve()).toBeNull();
    await f.db.pool.query("UPDATE route_shipments SET snapshot=$2 WHERE id=$1", [order.id, original]);
    expect((await f.db.pool.query("SELECT * FROM route_plan_publications ORDER BY vehicle_id")).rows).toEqual(before);
    await f.start();
    const version = (await f.db.pool.query("SELECT version FROM route_plans WHERE id=$1", [f.planId])).rows[0].version;
    await cancelPublishedRoute(f.db.pool, f.actor, f.planId, driver.vehicleId, { expectedVersion: version, expectedRevision: 1 });
    await expect(resolve()).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally { await f.close(); }
}, 120_000);

it("rejects invalid product ids before contacting Odoo", async () => {
  const config = { fingerprint: "local", url: "https://unused.invalid", database: "", username: "", credential: "", companyId: 1, timeoutMs: 1000, pickerNoteField: "", pickerNoteLabel: "" };
  expect(await readProductThumbnails([], config)).toEqual(new Map());
  await expect(readProductThumbnails([0], config)).rejects.toMatchObject({ code: "INVALID_INPUT" });
});

it.skipIf(!process.env.RUTAS_TEST_IMAGE_PRODUCT_ID)("reads images from real Odoo and prevents a different configured source from serving cached products", async () => {
  const config = readOdooConfig();
  const photoId = Number(process.env.RUTAS_TEST_IMAGE_PRODUCT_ID), missingId = Number(process.env.RUTAS_TEST_NO_IMAGE_PRODUCT_ID);
  const raw = await readProductThumbnails([photoId, missingId]);
  expect(await normalizeProductThumbnail(raw.get(photoId))).not.toBeNull();
  expect(await normalizeProductThumbnail(raw.get(missingId))).toBeNull();
  const f = await executionFixture({ sourceFingerprint: config.fingerprint });
  try {
    const initial = await readDriverPlan(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
    await f.db.pool.query("UPDATE route_shipments SET snapshot=jsonb_set(snapshot,'{lines,0,productId}',$2::jsonb) WHERE id=$1",
      [initial.orders[0].id, JSON.stringify(photoId)]);
    await f.db.pool.query("UPDATE route_shipments SET snapshot=jsonb_set(snapshot,'{lines,0,productId}',$2::jsonb) WHERE id=$1",
      [initial.orders[1].id, JSON.stringify(missingId)]);
    await f.start();
    const plan = await readDriverPlan(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
    const read = (index: number) => readDriverProductThumbnail(f.db.pool, f.members[0].driverId, f.planId, plan.orders[index].id, 0, 1, f.timezone);
    const first = await read(0);
    expect(first).not.toBeNull(); expect(await read(0)).toEqual(first); expect(await read(1)).toBeNull();
    const previous = process.env.ODOO_COMPANY_ID;
    try {
      process.env.ODOO_COMPANY_ID = String(config.companyId + 1);
      await expect(read(0)).rejects.toMatchObject({ code: "ODOO_SOURCE_CHANGED" });
    } finally { process.env.ODOO_COMPANY_ID = previous; }
  } finally { await f.close(); }
}, 120_000);
