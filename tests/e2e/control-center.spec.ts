import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { executionFixture } from "../helpers/driver-execution";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";
import { readDriverExecution } from "../../src/core/driver-execution-read";
import { executeStopCommand } from "../../src/core/driver-stop-command";
import { executeDriverOrderCommand } from "../../src/core/driver-order-command";
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
  for (const member of f.members) {
    const route = await readDriverExecution(f.db.pool, member.driverId, f.planId, f.timezone);
    const stop = route.stops[0];
    await executeStopCommand(f.db.pool, member.authorization, f.planId, stop.id, "arrival", {
      commandId: randomUUID(), executionId: route.id, publicationRevision: route.publicationRevision,
      executionRevision: route.revision, stopVersion: stop.version, visitSequence: stop.visitSequence,
      policyVersion: route.policy.version,
      sample: { latitude: 20.64, longitude: -103.4, accuracyMeters: 5,
        ageMilliseconds: 0, capturedAt: f.now.toISOString(), mock: false },
    }, f.timezone, f.now);
    const arrived = await readDriverExecution(f.db.pool, member.driverId, f.planId, f.timezone);
    const current = arrived.stops[0], order = current.orderStates[0];
    await executeDriverOrderCommand(f.db.pool, member.authorization, f.planId, current.id, order.shipmentId, {
      commandId: randomUUID(), executionId: arrived.id, publicationRevision: arrived.publicationRevision,
      executionRevision: arrived.revision, stopVersion: current.version, visitSequence: current.visitSequence,
      policyVersion: arrived.policy.version, orderVersion: order.version,
      kind: "reject", reasonCode: "other", note: "Caso visible en centro de control",
    }, f.timezone, f.now);
  }
  await page.request.post(`${origin}/api/session`, { headers: { Origin: origin }, data: { login, password } });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(origin);
  await page.getByRole("button", { name: "Centro de control", exact: true }).click();
  await expect(page.locator(".sidebar-foot")).toHaveCount(0);
  await expect(page.getByText("Acceso y datos propios.")).toHaveCount(0);
  await expect(page.getByText("TU OPERACIÓN, EN UNA VISTA", { exact: true })).toHaveCount(0);
  const help = page.locator("summary[aria-label='Información del Centro de control']");
  await expect(help).toBeVisible();
  await expect(page.getByText("Combina pantallas y dedica cada mapa a un chofer distinto.", { exact: false })).not.toBeVisible();
  await help.focus(); await page.keyboard.press("Enter");
  await expect(page.getByText("Combina pantallas y dedica cada mapa a un chofer distinto.", { exact: false })).toBeVisible();
  await help.click();
  const cards = page.locator(".control-grid > .control-screen");
  await expect(cards).toHaveCount(2);
  const incidentCard = cards.nth(1);
  await expect(incidentCard.getByLabel("Chofer", { exact: true })).toBeVisible();
  await expect(incidentCard.locator('input[type="date"]')).toHaveCount(0);
  const incidents = incidentCard.locator(".live-incident-card");
  await expect(incidents).toHaveCount(2);
  await incidentCard.getByLabel("Chofer", { exact: true }).selectOption(f.members[0].driverId);
  await expect(incidents).toHaveCount(1);
  await expect(incidentCard.locator(".live-incident-metrics")).toContainText("1");
  await incidentCard.getByLabel("Chofer", { exact: true }).selectOption("");
  await expect(incidents).toHaveCount(2);
  await page.setViewportSize({ width: 1500, height: 800 });
  const command = page.locator(".control-command");
  const titleBox = await command.getByRole("heading", { name: "Centro de control" }).boundingBox();
  const statusBox = await command.getByRole("status").boundingBox();
  const addBox = await command.getByRole("button", { name: "Agregar pantalla" }).boundingBox();
  const refreshBox = await command.getByRole("button", { name: "Actualizar" }).boundingBox();
  const gridBox = await page.locator(".control-grid").boundingBox();
  expect(titleBox && statusBox && addBox && refreshBox && gridBox).toBeTruthy();
  expect(Math.max(titleBox!.y, statusBox!.y, addBox!.y, refreshBox!.y) - Math.min(titleBox!.y, statusBox!.y, addBox!.y, refreshBox!.y)).toBeLessThan(12);
  expect(gridBox!.y).toBeLessThan(145);
  const routesRefreshed = page.waitForResponse(response => response.url().includes("/api/live-routes") && response.request().method() === "GET");
  const incidentsRefreshed = page.waitForResponse(response => response.url().includes("/api/incidents/live") && response.request().method() === "GET");
  await command.getByRole("button", { name: "Actualizar" }).click();
  expect((await routesRefreshed).status()).toBe(200);
  expect((await incidentsRefreshed).status()).toBe(200);
  await expect(incidents).toHaveCount(2);
  const secondBox = await incidents.nth(1).boundingBox(), bodyBox = await incidentCard.locator(".control-screen-body").boundingBox();
  expect(secondBox && bodyBox && secondBox.y + secondBox.height <= bodyBox.y + bodyBox.height).toBe(true);
  await mkdir(".local/qa/control-center", { recursive: true });
  await page.screenshot({ path: ".local/qa/control-center/incidents-compact.png" });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await expect(incidents.first().getByRole("button", { name: "Marcar resuelto" })).not.toBeVisible();
  await incidents.first().getByText("Detalles y acciones").click();
  await expect(incidents.first().getByRole("button", { name: "Marcar resuelto" })).toBeVisible();
  await incidents.first().getByText("Detalles y acciones").click();
  await expect(cards.nth(0).getByLabel("Chofer", { exact: true }).locator("option")).toHaveCount(3);
  await cards.nth(0).getByLabel("Chofer", { exact: true }).selectOption(f.members[0].driverId);
  await page.getByRole("button", { name: "Agregar pantalla", exact: true }).click();
  let picker = page.getByRole("dialog", { name: "Agregar pantalla al centro de control" });
  await picker.getByRole("radio", { name: /Ruta en vivo/ }).check();
  await picker.getByRole("button", { name: "Agregar pantalla", exact: true }).click();
  await expect(cards).toHaveCount(3);
  await cards.nth(2).getByLabel("Chofer", { exact: true }).selectOption(f.members[1].driverId);
  await expect(cards.nth(0).getByLabel("Chofer", { exact: true })).toHaveValue(f.members[0].driverId);
  await cards.nth(2).getByRole("button", { name: "Ver avance" }).click();
  await expect(cards.nth(2).getByRole("heading", { name: "Chofer 1", exact: true })).toBeVisible();
  await cards.nth(2).getByRole("button", { name: "Cerrar avance" }).click();
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
  await page.setViewportSize({ width: 1500, height: 800 });
  const fourTiles = await cards.evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, height: box.height };
  }));
  expect(fourTiles).toHaveLength(4);
  expect(fourTiles.every(tile => tile.top >= 0 && tile.bottom <= 800 && tile.height >= 200)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  await page.screenshot({ path: ".local/qa/control-center/four-screens.png" });
  const incidentScroll = await cards.nth(1).locator(".control-screen-body").evaluate(element => {
    element.scrollTop = element.scrollHeight;
    return { top: element.scrollTop, overflow: element.scrollHeight - element.clientHeight };
  });
  expect(incidentScroll.overflow).toBeGreaterThan(0);
  expect(incidentScroll.top).toBeGreaterThan(0);
  await page.setViewportSize({ width: 1366, height: 768 });
  const laptopTiles = await cards.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().bottom));
  expect(laptopTiles).toHaveLength(4);
  expect(laptopTiles.every(bottom => bottom <= 768)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.getByRole("button", { name: "Agregar pantalla", exact: true }).click();
  picker = page.getByRole("dialog", { name: "Agregar pantalla al centro de control" });
  await picker.getByRole("radio", { name: /Avance de rutas/ }).check();
  await picker.getByRole("button", { name: "Agregar pantalla", exact: true }).click();
  await expect(cards).toHaveCount(5);
  const boardScroll = await page.locator(".control-grid").evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight }));
  expect(boardScroll.content).toBeGreaterThan(boardScroll.height);
  await cards.nth(4).getByRole("button", { name: "Quitar pantalla 5" }).click();
  await expect(cards).toHaveCount(4);
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
  await expect(page.locator(".control-command").getByRole("button", { name: "Agregar pantalla" })).toBeVisible();
  await expect(page.locator(".control-command").getByRole("button", { name: "Actualizar" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator(".control-command").getByRole("button", { name: "Agregar pantalla" })).toBeVisible();
  await expect(page.locator(".control-command").getByRole("button", { name: "Actualizar" })).toBeVisible();
  await page.setViewportSize({ width: 720, height: 1000 });
  await page.getByRole("button", { name: "Incidencias en vivo", exact: true }).click();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(page.getByLabel("Chofer", { exact: true })).toBeVisible();
  await expect(page.locator(".live-incident-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Ruta en vivo", exact: true }).click();
  await page.getByRole("button", { name: "Ver avance" }).click();
  await expect(page.getByRole("heading", { name: "Chofer 0", exact: true })).toBeVisible();
});

test("four map-first screens keep their full canvas, driver-only filters and accessible details", async ({ page }) => {
  test.setTimeout(120000);
  const ownLogin = `map-${randomUUID()}`;
  await createUser(f.db.pool, f.actor, { name: "Map QA", login: ownLogin, password });
  await page.request.post(`${origin}/api/session`, { headers: { Origin: origin }, data: { login: ownLogin, password } });
  const screens = Array.from({ length: 4 }, (_,index) => ({ id: randomUUID(), type: "routes", driverId: f.members[index%2].driverId, vehicleId: randomUUID() }));
  expect((await page.request.put(`${origin}/api/control-center`, { headers: { Origin: origin }, data: { expectedVersion: 0, screens } })).status()).toBe(200);
  await page.setViewportSize({ width: 1500, height: 800 });
  await page.goto(origin);
  await page.getByRole("button", { name: "Centro de control", exact: true }).click();
  const cards = page.locator(".control-grid > .control-screen");
  await expect(cards).toHaveCount(4);
  await expect(page.getByLabel("Camioneta", { exact: true })).toHaveCount(0);
  await expect(page.locator(".live-map-wrap")).toHaveCount(4);
  await expect(page.getByText("El mapa no está configurado", { exact: false })).toHaveCount(4);
  for (const size of [{ width: 1500, height: 800 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(size);
    const dimensions = await cards.evaluateAll(elements => elements.map(element => {
      const card = element.getBoundingClientRect();
      const body = element.querySelector(".control-screen-body")!;
      const map = element.querySelector(".live-map-wrap")!.getBoundingClientRect();
      const canvas = element.querySelector(".live-map-canvas")!.getBoundingClientRect();
      const controls = element.querySelector(".live-map-tools")!.getBoundingClientRect();
      const summary = element.querySelector(".live-route-summary")!.getBoundingClientRect();
      return { fraction: map.height / card.height, map: map.height, bottom: card.bottom,
        canvas: canvas.height, canvasFraction: canvas.height / card.height, scroll: body.scrollHeight - body.clientHeight,
        separated: summary.top >= canvas.bottom && !element.querySelector(".live-map-canvas")!.contains(element.querySelector(".live-route-summary")),
        summaryBottomGap: map.bottom-summary.bottom, summaryHeight: summary.height,
        summaryInside: summary.left >= map.left && summary.right <= map.right,
        toolsInside: controls.top >= map.top && controls.right <= map.right && controls.bottom <= map.bottom };
    }));
    console.log(`Map geometry ${size.width}x${size.height}: ${JSON.stringify(dimensions)}`);
    expect(dimensions.every(d => d.fraction >= 0.70 && d.canvasFraction >= 0.65 && d.canvas >= 190 && d.bottom <= size.height && d.scroll <= 1 && d.separated && d.toolsInside)).toBe(true);
    expect(dimensions.every(d => d.summaryBottomGap >= 0 && d.summaryBottomGap <= 4 && d.summaryHeight <= 22 && d.summaryInside)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  }
  const card = cards.first();
  const details = card.getByRole("complementary", { name: "Avance de los choferes" });
  await expect(details).toBeHidden();
  const canvasBefore = await card.locator(".live-map-canvas").boundingBox();
  await card.getByRole("button", { name: "Ver avance" }).focus();
  await page.keyboard.press("Enter");
  await expect(details).toBeVisible();
  await expect(details.getByRole("heading", { name: "Chofer 0", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Cerrar avance" })).toBeFocused();
  expect((await card.locator(".live-map-canvas").boundingBox())!.height).toBe(canvasBefore!.height);
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(card.getByRole("button", { name: "Ver avance" })).toBeFocused();
  const buttonStyles = await card.locator(".live-map-tools button").evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element); return { background: style.backgroundColor, opacity: style.opacity, color: style.color };
  }));
  expect(buttonStyles.every(style => style.background === "rgb(38, 60, 48)" && style.opacity === "1" && style.color === "rgb(185, 201, 191)")).toBe(true);
  // Exercise the production marker DOM builder and final CSS in a real browser.
  // This does not replace Google Maps or fabricate a GPS/API response.
  const markerBundle = await build({ entryPoints: ["src/components/live-map-marker.ts"], bundle: true, write: false, format: "iife", globalName: "LiveMapMarkerTest" });
  await page.addScriptTag({ content: markerBundle.outputFiles[0].text });
  const markerAppearance = await page.evaluate(async () => {
    const builder = (window as unknown as { LiveMapMarkerTest: typeof import("../../src/components/live-map-marker") }).LiveMapMarkerTest;
    const icon = document.querySelector<SVGSVGElement>(".live-driver-icon-template")!;
    const { node, label } = builder.createLiveMapMarkerNode(icon);
    node.className = "live-map-driver live"; node.style.setProperty("--route-color", "#8dddac");
    node.setAttribute("aria-label", "Chofer QA"); label.textContent = "Nombre <img src=x> no visible";
    document.querySelector(".live-map-canvas")!.append(node);
    const svg = node.querySelector("svg")!;
    const appearance = { width: node.offsetWidth, height: node.offsetHeight,
      radius: getComputedStyle(node).borderRadius, textHidden: getComputedStyle(label).display === "none",
      svgVisible: getComputedStyle(svg).display !== "none", vector: svg.querySelectorAll("path,circle,rect").length,
      executableMarkup: node.querySelectorAll("img").length, color: getComputedStyle(node).backgroundColor,
      templateHidden: getComputedStyle(icon).display === "none" };
    node.className = "live-map-driver stale";
    // Wait for the real shared button color transition, not an arbitrary sleep.
    void getComputedStyle(node).backgroundColor;
    await Promise.all(node.getAnimations().map(animation => animation.finished));
    const staleColor = getComputedStyle(node).backgroundColor; node.remove();
    const stop = builder.createLiveMapMarkerNode(null);
    stop.label.textContent = "2"; stop.node.className = "live-map-stop";
    document.querySelector(".live-map-canvas")!.append(stop.node);
    const stopVisible = getComputedStyle(stop.label).display !== "none" && stop.node.textContent === "2";
    stop.node.remove();
    return { ...appearance, staleColor, stopVisible };
  });
  expect(markerAppearance).toMatchObject({ width: 38, height: 38, radius: "50%", textHidden: true, svgVisible: true,
    executableMarkup: 0, color: "rgb(141, 221, 172)", staleColor: "rgb(145, 162, 154)", templateHidden: true, stopVisible: true });
  expect(markerAppearance.vector).toBeGreaterThan(2);
  await card.getByRole("button", { name: "Ver todos los puntos" }).isDisabled().then(disabled => expect(disabled).toBe(true));
  await card.getByRole("button", { name: "Expandir 1", exact: false }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(card.getByLabel("Chofer", { exact: true })).toHaveValue(f.members[0].driverId);
  await expect(card.locator(".live-route-summary")).toHaveCount(1);
  expect(await card.locator(".live-map-wrap").evaluate(element => element.getBoundingClientRect().bottom - element.querySelector(".live-route-summary")!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(4);
  await card.getByRole("button", { name: "Ver avance" }).click();
  await expect(details).toBeVisible();
  await details.locator(".live-stop").last().click();
  await expect(details.locator(".live-selected-stop")).toBeVisible();
  await card.getByRole("button", { name: "Cerrar avance" }).click();
  await card.getByRole("button", { name: "Reducir 1", exact: false }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await card.getByLabel("Chofer", { exact: true }).selectOption(f.members[1].driverId);
  await expect(page.getByText("Distribución guardada", { exact: true })).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "Centro de control", exact: true }).click();
  await expect(cards.first().getByLabel("Chofer", { exact: true })).toHaveValue(f.members[1].driverId);
  await expect(cards.first().locator(".live-route-summary")).toContainText("0/1");
  const saved = await (await page.request.get(`${origin}/api/control-center`)).json();
  expect(saved.screens[0].vehicleId).toBe("");
  expect(saved.screens[1]).toEqual(screens[1]);
  await expect(page.locator(".live-map-wrap")).toHaveCount(4);
  await mkdir(".local/qa/control-center", { recursive: true });
  await page.screenshot({ path: ".local/qa/control-center/map-first-four.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const mobileSummary = await cards.first().locator(".live-map-wrap").evaluate(element => {
    const map = element.getBoundingClientRect(), summary = element.querySelector(".live-route-summary")!.getBoundingClientRect();
    const canvas = element.querySelector(".live-map-canvas")!.getBoundingClientRect();
    return { bottomGap: map.bottom-summary.bottom, inside: summary.left >= map.left && summary.right <= map.right, height: summary.height, separated: summary.top >= canvas.bottom };
  });
  expect(mobileSummary.inside && mobileSummary.bottomGap <= 4 && mobileSummary.height <= 36 && mobileSummary.separated).toBe(true);
  await cards.first().getByRole("button", { name: "Ver avance" }).click();
  await expect(cards.first().getByRole("button", { name: "Cerrar avance" })).toBeVisible();
});
