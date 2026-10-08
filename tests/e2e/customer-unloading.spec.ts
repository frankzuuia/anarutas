import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { publicationValidationFixture } from "../helpers/publication-validation";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";
import { orderBoard } from "../../src/core/orders";
import { buildDirectFleetRequest } from "../../src/core/route-google-direct";
import { zoneSettings } from "../helpers/zone-board";

let f: Awaited<ReturnType<typeof publicationValidationFixture>>;
let server: ChildProcess;
let origin: string;
const login = randomUUID(),
  password = randomUUID();

test.beforeAll(async () => {
  f = await publicationValidationFixture();
  await f.db.pool.query(
    "UPDATE route_plans SET departure_minute=480 WHERE id=$1",
    [f.planId],
  );
  await createUser(f.db.pool, f.actor, {
    name: "Panel QA",
    login,
    password,
    role: "routes",
  });
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        RUTAS_DATABASE_URL: f.db.config.databaseUrl,
        RUTAS_INSTANCE_ID: f.db.config.instanceId,
        RUTAS_BOOTSTRAP_TOKEN: f.db.config.bootstrapToken,
        RUTAS_APP_ORIGIN: origin,
        RUTAS_TIMEZONE: f.timezone,
        RUTAS_UNIT_PHOTO_DIR: f.photoRoot,
        ODOO_URL: "",
        ODOO_DATABASE: "",
        ODOO_EMAIL: "",
        ODOO_USERNAME: "",
        ODOO_API_KEY: "",
        ODOO_PASSWORD: "",
        ODOO_COMPANY_ID: "",
        RUTAS_GOOGLE_FINOPS_SERVICE_ACCOUNT_JSON_BASE64: "",
        RUTAS_GOOGLE_BILLING_EXPORT_PROJECT_ID: "",
        RUTAS_GOOGLE_BILLING_EXPORT_DATASET_ID: "",
        RUTAS_GOOGLE_BILLING_EXPORT_LOCATION: "",
      },
    },
  );
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/api/ready`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("PANEL_VALIDATION_SERVER_NOT_READY");
});
test.afterAll(async () => {
  if (server && server.exitCode === null)
    await new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
      server.kill();
    });
  await f?.close();
});

test("customer unload editor persists, reaches Google contract, protects roles and fits mobile", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  expect(
    (
      await context.request.post(`${origin}/api/session`, {
        headers: { Origin: origin },
        data: { login, password },
      })
    ).status(),
  ).toBe(200);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Clientes y horarios", exact: true })
    .click();
  const minutes = page.getByRole("spinbutton", { name: "Minutos por visita" });
  await expect(minutes).toBeVisible();
  const legends = await page.locator("form fieldset legend").allTextContents();
  expect(legends.slice(0, 4)).toEqual([
    "Prioridad",
    "Ventanas de horario · 24 horas",
    "Tiempo de descarga",
    "Modalidad",
  ]);
  await expect(
    page.getByRole("button", { name: "Añadir ventana", exact: true }),
  ).toHaveCount(0);
  await minutes.fill("23");
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" && r.url().includes("/api/customers/"),
  );
  await page
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const customer = await response.json();
  expect(customer.unloadingMinutes).toBe(23);
  await page.reload();
  await page
    .getByRole("button", { name: "Clientes y horarios", exact: true })
    .click();
  await expect(minutes).toHaveValue("23");
  const board = await orderBoard(f.db.pool, f.planId);
  const { request } = buildDirectFleetRequest(board, zoneSettings, f.timezone);
  expect(
    request.model.shipments.some((s) =>
      s.deliveries.some((v) => v.duration === "1380s"),
    ),
  ).toBe(true);
  const endpoint = `${origin}/api/customers/${customer.id}`;
  expect(
    (
      await context.request.patch(endpoint, {
        headers: { Origin: "https://foreign.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  const restricted = await browser.newContext();
  expect(
    (
      await restricted.request.patch(endpoint, {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
  ).toBe(401);
  const otherLogin = randomUUID(),
    otherPassword = randomUUID();
  await createUser(f.db.pool, f.actor, {
    name: "Liquidación QA",
    login: otherLogin,
    password: otherPassword,
    role: "settlement",
  });
  expect(
    (
      await restricted.request.post(`${origin}/api/session`, {
        headers: { Origin: origin },
        data: { login: otherLogin, password: otherPassword },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await restricted.request.patch(endpoint, {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
  ).toBe(403);
  await mkdir("reports/screenshots", { recursive: true });
  await page.screenshot({
    path: "reports/screenshots/customer-unloading-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await minutes.scrollIntoViewIfNeeded();
  await expect(minutes).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "reports/screenshots/customer-unloading-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await restricted.close();
  await context.close();
});

test("daily window editor preserves existing intervals and supports empty, removed and recaptured schedules", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  expect(
    (
      await context.request.post(`${origin}/api/session`, {
        headers: { Origin: origin },
        data: { login, password },
      })
    ).status(),
  ).toBe(200);
  const listed = await context.request.get(`${origin}/api/customers`);
  expect(listed.status()).toBe(200);
  const initial = (await listed.json()).customers[0];
  const endpoint = `${origin}/api/customers/${initial.id}`;
  // Prepare an existing multi-window record through the real authorized API.
  // Removing a creation control must never silently discard stored intervals.
  const prepared = await context.request.patch(endpoint, {
    headers: { Origin: origin },
    data: {
      displayName: initial.displayName,
      phone: initial.phone,
      deliveryNote: initial.deliveryNote,
      priority: initial.priority,
      unloadingMinutes: initial.unloadingMinutes,
      unloadingAutomatic: initial.unloadingAutomatic,
      fulfillmentMode: initial.fulfillmentMode,
      deliveryAddress: initial.deliveryAddress,
      mapUrl: initial.mapUrl,
      location: {
        latitude: initial.latitude,
        longitude: initial.longitude,
        placeId: initial.placeId,
      },
      windows: [
        { start: { hour: 8, minute: 0 }, end: { hour: 10, minute: 0 } },
        { start: { hour: 11, minute: 0 }, end: { hour: 13, minute: 0 } },
      ],
      expectedVersion: initial.version,
    },
  });
  expect(prepared.status()).toBe(200);
  const baseline = await prepared.json();
  const page = await context.newPage();
  const errors: string[] = [];
  const patches: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url() === endpoint)
      patches.push(request.postData() || "");
  });
  async function openEditor() {
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Clientes y horarios", exact: true })
      .click();
    await expect(page.getByLabel("Cliente", { exact: true })).toHaveValue(
      initial.displayName,
    );
  }
  async function saveEditor() {
    const response = page.waitForResponse(
      (item) => item.request().method() === "PATCH" && item.url() === endpoint,
    );
    await page
      .getByRole("button", { name: "Guardar cambios", exact: true })
      .click();
    const saved = await response;
    expect(saved.status()).toBe(200);
    return saved.json();
  }
  await openEditor();
  const windows = page.locator(".windows-editor");
  const save = page.getByRole("button", {
    name: "Guardar cambios",
    exact: true,
  });
  await expect(windows.locator(".window-row")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Añadir ventana", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Nota de entrega", exact: true })
    .fill("Ventanas conservadas QA");
  const retained = await saveEditor();
  expect(
    retained.windows.map((item: { startMinute: number; endMinute: number }) => [
      item.startMinute,
      item.endMinute,
    ]),
  ).toEqual([
    [480, 600],
    [660, 780],
  ]);
  for (const field of [
    "priority",
    "unloadingMinutes",
    "unloadingAutomatic",
    "fulfillmentMode",
    "displayName",
    "phone",
    "deliveryAddress",
    "mapUrl",
    "latitude",
    "longitude",
    "locationStatus",
  ])
    expect(retained[field]).toEqual(baseline[field]);

  await windows
    .getByRole("button", { name: "Quitar ventana 2", exact: true })
    .click();
  await windows
    .getByRole("button", { name: "Quitar ventana 1", exact: true })
    .click();
  await expect(windows.getByLabel("Desde", { exact: true })).toHaveValue("");
  await expect(windows.getByLabel("Hasta", { exact: true })).toHaveValue("");
  expect((await saveEditor()).windows).toEqual([]);
  await openEditor();
  await expect(save).toBeDisabled();
  await expect(windows.getByLabel("Desde", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "false",
  );
  await page
    .getByRole("textbox", { name: "Nota de entrega", exact: true })
    .fill("Sin horario QA");
  expect((await saveEditor()).windows).toEqual([]);

  const beforeInvalid = patches.length;
  await windows.getByLabel("Desde", { exact: true }).fill("11:00");
  await save.click();
  expect(
    await windows
      .getByLabel("Hasta", { exact: true })
      .evaluate((element: HTMLInputElement) => element.validity.valueMissing),
  ).toBe(true);
  expect(patches).toHaveLength(beforeInvalid);
  await windows.getByLabel("Desde", { exact: true }).fill("24:00");
  await windows.getByLabel("Hasta", { exact: true }).fill("13:00");
  await save.click();
  expect(
    await windows
      .getByLabel("Desde", { exact: true })
      .evaluate(
        (element: HTMLInputElement) => element.validity.patternMismatch,
      ),
  ).toBe(true);
  expect(patches).toHaveLength(beforeInvalid);
  await windows.getByLabel("Desde", { exact: true }).fill("11:00");
  const recaptured = await saveEditor();
  expect(recaptured.windows).toHaveLength(1);
  expect(recaptured.windows[0]).toMatchObject({
    startMinute: 660,
    endMinute: 780,
  });
  const persisted = (
    await f.db.pool.query(
      "SELECT start_minute,end_minute FROM route_customer_windows WHERE customer_id=$1",
      [initial.id],
    )
  ).rows;
  expect(persisted).toEqual([{ start_minute: 660, end_minute: 780 }]);
  await openEditor();
  await expect(windows.getByLabel("Desde", { exact: true })).toHaveValue(
    "11:00",
  );
  await expect(windows.getByLabel("Hasta", { exact: true })).toHaveValue(
    "13:00",
  );
  await expect(save).toBeDisabled();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await windows.scrollIntoViewIfNeeded();
    await expect(windows).toBeVisible();
    const fieldOrder = await page
      .locator(".customer-editor-scroll > fieldset > legend")
      .allTextContents();
    expect(fieldOrder.slice(0, 4)).toEqual([
      "Prioridad",
      "Ventanas de horario · 24 horas",
      "Tiempo de descarga",
      "Modalidad",
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `reports/screenshots/customer-window-${width}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
  await context.close();
});
