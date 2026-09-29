import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { executionFixture } from "../helpers/driver-execution";
import { freePort } from "../helpers/postgres";
import { readOdooConfig } from "../../src/core/config";
import { readDriverPlan } from "../../src/core/driver-mobile-route";
import { cancelPublishedRoute } from "../../src/core/route-publications";

test("real Odoo thumbnails stay private, preserve publications and tolerate missing pictures", async ({ request }) => {
  test.skip(!process.env.RUTAS_TEST_IMAGE_PRODUCT_ID, "Requires configured read-only Odoo and discovered image/no-image product ids");
  test.setTimeout(120_000);
  const f = await executionFixture({ sourceFingerprint: readOdooConfig().fingerprint });
  let server: ChildProcess | undefined;
  try {
    const original = await readDriverPlan(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
    for (const [index, productId] of [process.env.RUTAS_TEST_IMAGE_PRODUCT_ID, process.env.RUTAS_TEST_NO_IMAGE_PRODUCT_ID].entries())
      await f.db.pool.query("UPDATE route_shipments SET snapshot=jsonb_set(snapshot,'{lines,0,productId}',$2::jsonb) WHERE id=$1",
        [original.orders[index].id, JSON.stringify(Number(productId))]);
    await f.start();
    const before = (await f.db.pool.query("SELECT * FROM route_plan_publications ORDER BY vehicle_id")).rows;
    const port = await freePort(), origin = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      windowsHide: true, stdio: "ignore", env: { ...process.env, RUTAS_DATABASE_URL: f.db.config.databaseUrl,
        RUTAS_INSTANCE_ID: f.db.config.instanceId, RUTAS_BOOTSTRAP_TOKEN: f.db.config.bootstrapToken,
        RUTAS_APP_ORIGIN: origin, RUTAS_TIMEZONE: f.timezone, RUTAS_UNIT_PHOTO_DIR: f.photoRoot,
        RUTAS_GOOGLE_MAPS_BROWSER_KEY: "", RUTAS_GOOGLE_MAP_ID: "" },
    });
    await expect.poll(async () => { try { return (await fetch(`${origin}/api/ready`)).ok; } catch { return false; } }, { timeout: 30_000 }).toBe(true);
    const headers = { Authorization: f.members[0].authorization };
    const planResponse = await request.get(`${origin}/api/mobile/plans/${f.planId}`, { headers });
    expect(planResponse.status()).toBe(200);
    const plan = await planResponse.json();
    const photo = origin + plan.orders[0].lines[0].thumbnailPath, missing = origin + plan.orders[1].lines[0].thumbnailPath;
    expect((await request.get(photo)).status()).toBe(401);
    expect((await request.get(photo, { headers: { Authorization: f.members[1].authorization } })).status()).toBe(404);
    expect((await request.get(photo.replace("revision=1", "revision=2"), { headers })).status()).toBe(409);
    expect((await request.get(photo.replace("revision=1", "revision=0"), { headers })).status()).toBe(400);
    expect((await request.get(photo.replace(plan.orders[0].id, randomUUID()), { headers })).status()).toBe(404);
    const started = performance.now();
    const copies = await Promise.all(Array.from({ length: 8 }, () => request.get(photo, { headers })));
    console.info(`Concurrent real Odoo image requests: ${Math.round(performance.now() - started)} ms`);
    for (const response of copies) {
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store, private");
      expect(response.headers()["content-type"]).toBe("image/webp");
      const metadata = await sharp(await response.body()).metadata();
      expect(metadata.width).toBeLessThanOrEqual(128); expect(metadata.height).toBeLessThanOrEqual(128);
    }
    const absent = await request.get(missing, { headers });
    expect(absent.status()).toBe(204); expect((await absent.body()).length).toBe(0);
    expect((await f.db.pool.query("SELECT * FROM route_plan_publications ORDER BY vehicle_id")).rows).toEqual(before);
    const version = (await f.db.pool.query("SELECT version FROM route_plans WHERE id=$1", [f.planId])).rows[0].version;
    await cancelPublishedRoute(f.db.pool, f.actor, f.planId, f.members[0].vehicleId, { expectedVersion: version, expectedRevision: 1 });
    expect((await request.get(photo, { headers })).status()).toBe(404);
  } finally {
    if (server && server.exitCode === null) await new Promise<void>(resolve => { server!.once("exit", () => resolve()); server!.kill(); });
    await f.close();
  }
});
