import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { executionFixture } from "../helpers/driver-execution";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";
import { readDriverExecution } from "../../src/core/driver-execution-read";
import { executeStopCommand } from "../../src/core/driver-stop-command";

let f: Awaited<ReturnType<typeof executionFixture>>;
let server: ChildProcess;
let origin: string;
const login = `product-${randomUUID()}`, password = randomUUID();
test.beforeAll(async () => {
  test.setTimeout(120_000);
  f = await executionFixture(); await f.start();
  await createUser(f.db.pool, f.actor, { name: "Product QA", login, password });
  const execution = await readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone), stop = execution.stops[0];
  await executeStopCommand(f.db.pool, f.members[0].authorization, f.planId, stop.id, "arrival", {
    commandId: randomUUID(), executionId: execution.id, publicationRevision: execution.publicationRevision,
    executionRevision: execution.revision, stopVersion: stop.version, policyVersion: execution.policy.version,
    sample: { latitude: 20.64, longitude: -103.4, accuracyMeters: 5, ageMilliseconds: 0, capturedAt: f.now.toISOString(), mock: false },
  }, f.timezone, f.now);
  const port = await freePort(); origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    windowsHide: true, stdio: "ignore", env: { ...process.env, RUTAS_DATABASE_URL: f.db.config.databaseUrl,
      RUTAS_INSTANCE_ID: f.db.config.instanceId, RUTAS_BOOTSTRAP_TOKEN: f.db.config.bootstrapToken,
      RUTAS_APP_ORIGIN: origin, RUTAS_TIMEZONE: f.timezone, RUTAS_UNIT_PHOTO_DIR: f.photoRoot,
      RUTAS_GOOGLE_MAPS_BROWSER_KEY: "", RUTAS_GOOGLE_MAP_ID: "", ODOO_URL: "", ODOO_DATABASE: "", ODOO_EMAIL: "", ODOO_API_KEY: "" },
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${origin}/api/ready`)).ok) return; } catch { /* local server startup */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("PRODUCT_SERVER_NOT_READY");
});
test.afterAll(async () => {
  if (server && server.exitCode === null) await new Promise<void>(resolve => { server.once("exit", () => resolve()); server.kill(); });
  await f?.close();
});

test("mobile report → live visibility → admin classification → exact private Excel → resolution", async ({ page, request }) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  const route = await readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone), stop = route.stops[0];
  const path = `${origin}/api/mobile/plans/${f.planId}/stops/${stop.id}/orders/${stop.shipmentIds[0]}/product-incidents`;
  const data = { commandId: randomUUID(), executionId: route.id, publicationRevision: route.publicationRevision,
    executionRevision: route.revision, stopVersion: stop.version, visitSequence: stop.visitSequence,
    orderVersion: stop.orderStates[0].version, kind: "replacement_quality", department: "Operaciones", lineIndex: 0, quantity: "0.25", note: "Producto dañado" };
  for (const apiPath of ["/api/incidents/products", "/api/incidents/products/export"])
    expect((await request.get(origin + apiPath)).status()).toBe(401);
  expect((await request.post(path, { data })).status()).toBe(401);
  expect((await request.post(path, { data, headers: { Authorization: f.members[1].authorization } })).status()).toBe(404);
  const headers = { Authorization: f.members[0].authorization };
  expect((await request.post(path, { headers, data })).status()).toBe(400);
  const photo = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#779f32" } }).jpeg().toBuffer();
  const withPhoto = (command = data) => ({ data: photo, headers: { ...headers, "Content-Type": "image/jpeg",
    "X-Ana-Rutas-Command": Buffer.from(JSON.stringify(command)).toString("base64") } });
  expect((await request.post(path, { data: photo, headers: { ...headers, "Content-Type": "image/jpeg", "X-Ana-Rutas-Command": "[]" } })).status()).toBe(400);
  const started = performance.now();
  const response = await request.post(path, withPhoto());
  expect(response.status()).toBe(201);
  const receipt = await response.json();
  expect((await (await request.post(path, withPhoto())).json()).incidentId).toBe(receipt.incidentId);
  expect((await request.post(path, withPhoto({ ...data, commandId: randomUUID() }))).status()).toBe(409);
  const evidenceUrl = `${origin}/api/incidents/products/${receipt.incidentId}/evidence`;
  expect((await request.get(evidenceUrl)).status()).toBe(401);
  console.log(`Product write HTTP latency: ${Math.round(performance.now() - started)} ms (including replay/conflict)`);
  expect((await page.request.post(`${origin}/api/session`, { headers: { Origin: origin }, data: { login, password } })).status()).toBe(200);
  const classification = `${origin}/api/incidents/products/${receipt.incidentId}/classification`;
  expect((await page.request.patch(classification, { headers: { Origin: "https://foreign.invalid" }, data: { expectedVersion: 1, department: "Compras", concept: "Picking" } })).status()).toBe(403);
  await page.setViewportSize({ width: 1500, height: 800 });
  await page.goto(origin);
  await page.getByRole("button", { name: "Incidencias en vivo", exact: true }).click();
  const live = page.getByRole("region", { name: "Reposiciones pendientes", exact: true });
  await expect(live).toContainText("Producto 1");
  await expect(live).toContainText("Reportó: Chofer 0");
  await expect(live.getByRole("img", { name: "Evidencia: Producto 1" })).toBeVisible();
  const evidence = await page.request.get(evidenceUrl);
  expect(evidence.status()).toBe(200);
  expect(evidence.headers()["content-type"]).toBe("image/webp");
  expect(evidence.headers()["cache-control"]).toContain("private");
  expect((await sharp(await evidence.body()).metadata()).format).toBe("webp");
  await expect.poll(async () => (await f.db.pool.query(
    "SELECT archived_at IS NOT NULL AS archived FROM route_plans WHERE id=$1", [f.planId])).rows[0].archived,
  { timeout: 20_000, message: "Startup worker catches up the weekly archive without deleting live product evidence" }).toBe(true);
  await expect(live).toContainText("Producto 1");
  expect((await page.request.get(evidenceUrl)).status()).toBe(200);
  await page.getByLabel("Chofer", { exact: true }).selectOption(f.members[1].driverId);
  await expect(live).toContainText("Sin reposiciones pendientes");
  await page.getByLabel("Chofer", { exact: true }).selectOption(f.members[0].driverId);
  await expect(live).toContainText("Producto 1");
  await page.getByRole("button", { name: "Incidencias", exact: true }).click();
  const history = page.getByRole("region", { name: "Incidencias por producto", exact: true });
  await expect(history).toContainText("Reportó: Chofer 0");
  await expect(history.getByRole("button", { name: "Resolver", exact: true })).toHaveCount(0);
  await expect(history).toContainText("Comentarios / evidencia");
  await history.getByRole("button", { name: "Editar clasificación" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar clasificación" });
  await dialog.getByLabel("Departamento", { exact: true }).fill("Compras");
  await dialog.getByLabel("Concepto", { exact: true }).fill("Especiales");
  await dialog.getByRole("button", { name: "Guardar clasificación" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(history).toContainText("Especiales");
  expect((await page.request.patch(classification, { headers: { Origin: origin }, data: { expectedVersion: 1, department: "Operaciones", concept: "Reparto" } })).status()).toBe(409);
  const url = await history.getByRole("link", { name: "Exportar Excel" }).getAttribute("href");
  const download = await page.request.get(origin + url!);
  expect(download.status()).toBe(200);
  expect(download.headers()["cache-control"]).toContain("private");
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await download.body() as never);
  const sheet = workbook.getWorksheet("Incidencias")!;
  expect(sheet.columnCount).toBe(9);
  expect(sheet.getCell("F2").value).toBe("Compras");
  expect(sheet.getCell("D2").value).toBe(.25);
  expect(JSON.stringify(sheet.model)).not.toContain("Chofer 0");
  expect(JSON.stringify(sheet.model)).not.toContain("Especiales");
  await mkdir(".local/qa/product-incidents", { recursive: true });
  await page.screenshot({ path: ".local/qa/product-incidents/history.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".local/qa/product-incidents/mobile-panel.png", fullPage: true });
  await page.setViewportSize({ width: 1500, height: 800 });
  await page.getByRole("button", { name: "Incidencias en vivo", exact: true }).click();
  await live.getByRole("button", { name: "Resolver", exact: true }).click();
  const resolve = page.getByRole("dialog", { name: "Resolver incidencia de producto" });
  await resolve.getByLabel("Cómo se resolvió").fill("Reposición confirmada por administración");
  await resolve.getByRole("button", { name: "Confirmar resolución" }).click();
  await expect(live).toContainText("Sin reposiciones pendientes");
  const rows = (await f.db.pool.query("SELECT status,department,concept,quantity::text,snapshot FROM route_product_incidents WHERE id=$1", [receipt.incidentId])).rows;
  expect(rows).toMatchObject([{ status: "resolved", department: "Compras", concept: "Especiales", quantity: "0.250000", snapshot: { reportedDepartment: "Operaciones" } }]);
  expect((await f.db.pool.query("SELECT action FROM route_audit WHERE entity_id=$1 ORDER BY id", [receipt.incidentId])).rows.map(row => row.action))
    .toEqual(["product_incident.classified", "product_incident.resolved"]);
  expect(pageErrors).toEqual([]);
});
