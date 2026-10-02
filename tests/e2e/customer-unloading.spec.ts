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
  expect(legends.slice(0, 3)).toEqual([
    "Prioridad",
    "Tiempo de descarga",
    "Modalidad",
  ]);
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
