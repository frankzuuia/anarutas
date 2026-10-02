import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { publicationValidationFixture } from "../helpers/publication-validation";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";
import { transaction } from "../../src/core/database";
import {
  lockDraftSourcePlans,
  refreshDraftSourceShipments,
} from "../../src/core/draft-source-sync";

let f: Awaited<ReturnType<typeof publicationValidationFixture>>;
let server: ChildProcess;
let origin: string;
const login = randomUUID(),
  password = randomUUID();

test.beforeAll(async () => {
  f = await publicationValidationFixture();
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

test("panel activation skips pending trucks, informs folios and re-enables by real worker/SSE", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const board = await f.storeCalculation(),
    [a, b] = f.members;
  const own = board.shipments.filter((s) => s.vehicle_id === a.vehicleId);
  const unassigned = board.shipments.find((s) => !s.vehicle_id)!;
  for (const s of [own[1], own[2], unassigned])
    await f.setStatus(s.id, "pending_validation");
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [],
    manualRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/recalculation/manual")
    )
      manualRequests.push(request.url());
  });
  const endpoint = `${origin}/api/plans/${f.planId}/publications`;
  expect(
    (
      await context.request.post(endpoint, {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await context.request.post(`${origin}/api/session`, {
        headers: { Origin: origin },
        data: { login, password },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await context.request.post(endpoint, {
        headers: { Origin: "https://foreign.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  const denied = await context.request.post(endpoint, {
    headers: { Origin: origin },
    data: {
      scope: "vehicle",
      vehicleId: a.vehicleId,
      expectedVersion: board.plan.version,
    },
  });
  expect(denied.status()).toBe(409);
  expect(await denied.json()).toMatchObject({
    error: "ROUTE_ORDERS_NOT_VALIDATED",
    unavailableFolios: own.slice(1).map((s) => s.orderName),
  });
  expect(
    (
      await f.db.pool.query(
        "SELECT 1 FROM route_plan_publications WHERE plan_id=$1",
        [f.planId],
      )
    ).rowCount,
  ).toBe(0);

  await page.goto(origin);
  await page.getByLabel("Abrir borrador").selectOption(f.planId);
  const laneA = page.locator(".order-lane").filter({ hasText: "Unidad 0" });
  const laneB = page.locator(".order-lane").filter({ hasText: "Unidad 1" });
  const activateA = laneA.getByRole("button", {
    name: "Activar ruta",
    exact: true,
  });
  await expect(activateA).toBeDisabled();
  await expect(laneA.getByRole("status")).toContainText("S2, S3");
  await expect(
    laneB.getByRole("button", { name: "Activar ruta", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Armar ruta con optimización vial de Google", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Cargar pedidos de Odoo", exact: true }),
  ).toBeEnabled();
  expect(manualRequests).toHaveLength(0);
  await mkdir("reports/screenshots", { recursive: true });
  await page.screenshot({
    path: "reports/screenshots/panel-activation-pending-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Publicar rutas", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Confirmar publicación" });
  await expect(dialog.getByRole("status")).toContainText("Unidad 0");
  await expect(dialog.getByRole("status")).toContainText("S2, S3");
  const confirm = dialog.getByRole("button", {
    name: "Confirmar publicación",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  const publication = page.waitForResponse(
    (response) =>
      response.url() === endpoint && response.request().method() === "POST",
  );
  await confirm.click();
  const result = await (await publication).json();
  expect(result.changes).toEqual([
    { vehicleId: b.vehicleId, revision: 2, action: "published" },
  ]);
  expect(result.skippedValidationVehicles).toEqual([
    {
      vehicleId: a.vehicleId,
      vehicleName: "Unidad 0",
      pendingValidationOrders: own
        .slice(1)
        .map((s) => ({ id: s.id, orderName: s.orderName })),
    },
  ]);
  await expect(
    laneB.getByText("Ruta publicada", { exact: true }),
  ).toBeVisible();
  await expect(activateA).toBeDisabled();
  await expect(page.locator(".orders-section > .notice")).toContainText(
    "La ruta de Unidad 0 no se pudo activar",
  );
  await expect(page.locator(".orders-section > .notice")).toContainText(
    "S2, S3",
  );
  expect(
    (
      await f.db.pool.query(
        "SELECT vehicle_id FROM route_plan_publications WHERE plan_id=$1",
        [f.planId],
      )
    ).rows,
  ).toEqual([{ vehicle_id: b.vehicleId }]);

  const applySource = async (ids: string[], pending = false) => {
    const snapshots = await Promise.all(
      ids.map((id) => f.workerObservation(id)),
    );
    if (pending)
      for (const snapshot of snapshots) {
        snapshot.picking.state = "assigned";
        snapshot.picking.validatedAt = null;
      }
    await transaction(f.db.pool, async (sql) => {
      const plans = await lockDraftSourcePlans(sql, snapshots);
      expect(await refreshDraftSourceShipments(sql, snapshots, plans)).toBe(
        ids.length,
      );
    });
    await f.storeCalculation();
  };
  const validatedAt = performance.now();
  await applySource(own.slice(1).map((s) => s.id));
  await expect(activateA).toBeEnabled();
  console.info(
    `Panel validation worker/SSE to enabled: ${Math.round(performance.now() - validatedAt)} ms`,
  );
  await activateA.click();
  await expect(confirm).toBeEnabled();
  await applySource([own[2].id], true);
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByRole("status")).toContainText(own[2].orderName);
  expect(manualRequests).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "reports/screenshots/panel-activation-pending-mobile.png",
    fullPage: true,
  });
  await applySource([own[2].id]);
  await expect(confirm).toBeEnabled();
  const last = page.waitForResponse(
    (response) =>
      response.url() === endpoint && response.request().method() === "POST",
  );
  await confirm.click();
  expect((await last).status()).toBe(200);
  await expect(
    laneA.getByText("Ruta publicada", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM route_plan_publications WHERE plan_id=$1",
        [f.planId],
      )
    ).rows[0].n,
  ).toBe(2);
  await context.close();
});
