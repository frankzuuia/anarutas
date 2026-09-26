import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { executionFixture } from "../helpers/driver-execution";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";
import { readDriverExecution } from "../../src/core/driver-execution-read";
import { controlScreenTypes } from "../../src/core/control-screens";

let f: Awaited<ReturnType<typeof executionFixture>>;
let server: ChildProcess;
let origin: string;
let execution: Awaited<ReturnType<typeof readDriverExecution>>;
const login = `control-${randomUUID()}`, password = randomUUID();
test.beforeAll(async () => {
  test.setTimeout(120000);
  f = await executionFixture(); await f.start(); await f.start(f.members[1]);
  await createUser(f.db.pool, f.actor, { name: "Control QA", login, password });
  execution = await readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
  const port = await freePort(); origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    windowsHide: true, stdio: "ignore", env: { ...process.env, RUTAS_DATABASE_URL: f.db.config.databaseUrl,
      RUTAS_INSTANCE_ID: f.db.config.instanceId, RUTAS_BOOTSTRAP_TOKEN: f.db.config.bootstrapToken,
      RUTAS_APP_ORIGIN: origin, RUTAS_TIMEZONE: f.timezone, RUTAS_UNIT_PHOTO_DIR: f.photoRoot,
      RUTAS_GOOGLE_MAPS_BROWSER_KEY: "", RUTAS_GOOGLE_MAP_ID: "", ODOO_URL: "", ODOO_DATABASE: "", ODOO_EMAIL: "", ODOO_API_KEY: "" },
  });
  const deadline = Date.now()+30000;
  while (Date.now()<deadline) {
    try { if ((await fetch(`${origin}/api/ready`)).ok) return; } catch { /* waiting for local server */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("CONTROL_SERVER_NOT_READY");
});
test.afterAll(async () => {
  if (server && server.exitCode === null) await new Promise<void>(resolve => { server.once("exit", () => resolve()); server.kill(); });
  await f?.close();
});
test("private telemetry and per-user layout contracts over real HTTP", async ({ request }) => {
  for (const path of ["/api/live-routes", "/api/control-center"]) expect((await request.get(origin+path)).status()).toBe(401);
  const tracking = `${origin}/api/mobile/plans/${f.planId}/tracking`;
  const identity = { executionId: execution.id, publicationRevision: execution.publicationRevision, sessionId: randomUUID() };
  expect((await request.post(tracking, { data: { ...identity, kind: "begin" } })).status()).toBe(401);
  const headers = { Authorization: f.members[0].authorization };
  expect((await request.post(tracking, { headers, data: { ...identity, kind: "begin" } })).status()).toBe(200);
  expect((await request.post(tracking, { headers: { Authorization: f.members[1].authorization }, data: { ...identity, kind: "begin" } })).status()).toBe(409);
  const start = performance.now();
  expect((await request.post(tracking, { headers, data: { ...identity, kind: "sample", sequence: 1,
    targetStopId: execution.stops[1].id, sample: { latitude: 20.64, longitude: -103.4, accuracyMeters: 8, ageMilliseconds: 0, mock: false } } })).status()).toBe(200);
  expect((await request.post(`${origin}/api/session`, { headers: { Origin: origin }, data: { login, password } })).status()).toBe(200);
  const live = await request.get(`${origin}/api/live-routes`);
  expect(live.status()).toBe(200); expect(live.headers()["cache-control"]).toContain("private");
  expect((await live.json()).routes.find((r: { id: string }) => r.id === execution.id)).toMatchObject({ targetStopId: execution.stops[1].id, location: { latitude: 20.64 } });
  console.log(`Tracking HTTP write/read latency: ${Math.round(performance.now()-start)} ms`);
  expect((await request.put(`${origin}/api/control-center`, { headers: { Origin: "https://foreign.invalid" }, data: { expectedVersion: 0, screens: [] } })).status()).toBe(403);
  expect((await request.put(`${origin}/api/control-center`, { headers: { Origin: origin }, data: { expectedVersion: 0, screens: [{ id: randomUUID(), type: "control_center", driverId: "", vehicleId: "" }] } })).status()).toBe(400);
});
test("independent drivers, arbitrary panel screens, persistence, expand and removal", async ({ page }) => {
  test.setTimeout(180000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.request.post(`${origin}/api/session`, { headers: { Origin: origin }, data: { login, password } });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(origin);
  await page.getByRole("button", { name: "Centro de control", exact: true }).click();
  const cards = page.locator(".control-grid > .control-screen");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).getByLabel("Chofer", { exact: true }).locator("option")).toHaveCount(3);
  await cards.nth(0).getByLabel("Chofer", { exact: true }).selectOption(f.members[0].driverId);
  await page.getByRole("button", { name: "Agregar pantalla", exact: true }).click();
  let picker = page.getByRole("dialog", { name: "Agregar pantalla al centro de control" });
  await picker.getByRole("radio", { name: /Ruta en vivo/ }).check();
  await picker.getByRole("button", { name: "Agregar pantalla", exact: true }).click();
  await expect(cards).toHaveCount(3);
  await cards.nth(2).getByLabel("Chofer", { exact: true }).selectOption(f.members[1].driverId);
  await expect(cards.nth(0).getByLabel("Chofer", { exact: true })).toHaveValue(f.members[0].driverId);
  await expect(cards.nth(2).getByRole("heading", { name: "Chofer 1", exact: true })).toBeVisible();
  await expect(page.getByText("Distribución guardada", { exact: true })).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "Centro de control", exact: true }).click();
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0).getByLabel("Chofer", { exact: true })).toHaveValue(f.members[0].driverId);
  await expect(cards.nth(2).getByLabel("Chofer", { exact: true })).toHaveValue(f.members[1].driverId);
  await page.getByRole("button", { name: "Agregar pantalla", exact: true }).click();
  picker = page.getByRole("dialog", { name: "Agregar pantalla al centro de control" });
  await picker.getByRole("radio", { name: /Clientes y horarios/ }).check();
  await picker.getByRole("button", { name: "Agregar pantalla", exact: true }).click();
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(3).getByRole("button", { name: "Actualizar clientes", exact: true })).toBeVisible();
  await cards.nth(3).getByRole("button", { name: /Expandir 4/ }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await cards.nth(3).getByRole("button", { name: /Reducir 4/ }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await cards.nth(3).getByRole("button", { name: "Mover pantalla 4 antes" }).click();
  await expect(cards.nth(2).getByRole("button", { name: "Actualizar clientes", exact: true })).toBeVisible();
  await cards.nth(2).getByRole("button", { name: "Quitar pantalla 3" }).click();
  await expect(cards).toHaveCount(3);
  for (const type of controlScreenTypes.filter(type => type.id.startsWith("panel:"))) {
    await page.getByRole("button", { name: "Agregar pantalla", exact: true }).click();
    const selector = page.getByRole("dialog", { name: "Agregar pantalla al centro de control" });
    await selector.locator(`input[value="${type.id}"]`).check();
    await selector.getByRole("button", { name: "Agregar pantalla", exact: true }).click();
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(3).locator(".embedded-dashboard")).toBeVisible();
    await expect(cards.nth(3).locator("h1")).toBeVisible();
    await cards.nth(3).getByRole("button", { name: "Quitar pantalla 4" }).click();
    await expect(cards).toHaveCount(3);
  }
  expect(pageErrors).toEqual([]);
  await mkdir(".local/qa/control-center", { recursive: true });
  await page.screenshot({ path: ".local/qa/control-center/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 720, height: 1000 });
  await page.screenshot({ path: ".local/qa/control-center/narrow.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Ruta en vivo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chofer 0", exact: true })).toBeVisible();
});
