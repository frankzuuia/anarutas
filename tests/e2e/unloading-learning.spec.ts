import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { unloadingLearningFixture } from "../helpers/unloading-learning";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";

let f: Awaited<ReturnType<typeof unloadingLearningFixture>>,
  server: ChildProcess,
  origin: string;
const login = randomUUID(),
  password = randomUUID();
test.beforeAll(async () => {
  f = await unloadingLearningFixture();
  await createUser(f.db.pool, f.actor, {
    name: "Descarga QA",
    login,
    password,
    role: "routes",
  });
  origin = `http://127.0.0.1:${await freePort()}`;
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      new URL(origin).port,
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
        RUTAS_GOOGLE_CLOUD_PROJECT_ID: "",
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
  throw new Error("UNLOADING_HTTP_NOT_READY");
});
test.afterAll(async () => {
  if (server && server.exitCode === null)
    await new Promise<void>((resolve) => {
      server.once("exit", resolve);
      server.kill();
    });
  await f?.close();
});

test("real collection HTTP learns, pushes to the open panel and preserves unsaved/manual controls", async ({
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
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Clientes y horarios", exact: true })
    .click();
  await expect(
    page.getByText("Aprendiendo: 0/2 visitas", { exact: true }),
  ).toBeVisible();
  const pay = async (stop: number, order: number, captured: Date) => {
    const command = await f.command(stop, order, captured.toISOString());
    const result = await context.request.post(
      `${origin}/api/mobile/finance/${f.executionId}/payments`,
      {
        headers: { Authorization: f.members[0].authorization },
        data: command,
      },
    );
    expect(result.status()).toBe(200);
    return command;
  };
  await pay(0, 0, new Date(+f.now + 10 * 60000));
  await pay(0, 1, new Date(+f.now + 30 * 60000));
  await expect(
    page.getByText("Aprendiendo: 1/2 visitas", { exact: true }),
  ).toBeVisible();
  await f.arrive(2, new Date(+f.now + 120 * 60000));
  await pay(2, 0, new Date(+f.now + 150 * 60000));
  await expect(
    page.getByText("Automático: 30 min por visita", { exact: true }),
  ).toBeVisible();
  const input = page.getByRole("spinbutton", { name: "Minutos por visita" });
  await expect(input).toHaveValue("15");
  await input.fill("18");
  await f.visit(4, 40);
  await expect(input).toHaveValue("18");
  await page.getByRole("button", { name: "Manual fijo", exact: true }).click();
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" && r.url().includes("/api/customers/"),
  );
  await page
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  const response = await saved;
  expect(response.status()).toBe(200);
  expect((await response.json()).unloadingEstimate.effectiveMinutes).toBe(18);
  await mkdir("reports/screenshots", { recursive: true });
  await page.getByRole("button", { name: "Automático", exact: true }).click();
  await page.screenshot({
    path: "reports/screenshots/unloading-learning-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByText("Automático: 30 min por visita", { exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "reports/screenshots/unloading-learning-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await context.close();
});
