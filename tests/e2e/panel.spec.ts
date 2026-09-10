import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { startPostgres, freePort } from "../helpers/postgres";
import { fleetFlow } from "./fleet-flow";
import {
  persistImportPage,
  orderBoard,
  selectPlanVehicles,
} from "../../src/core/orders";
import { createVehicle } from "../../src/core/fleet";
import { listCustomers, persistCustomerPage } from "../../src/core/customers";

let db: Awaited<ReturnType<typeof startPostgres>>;
let child: ChildProcess;
let origin: string;
let nodePort: number;
const userLogin = `qa-${randomUUID()}`;
// Six-character boundary only in an isolated QA installation, never a real account default.
const password = randomUUID().slice(0, 6);
async function startApp() {
  child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(nodePort),
    ],
    {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        RUTAS_DATABASE_URL: db.config.databaseUrl,
        RUTAS_INSTANCE_ID: db.config.instanceId,
        RUTAS_APP_ORIGIN: origin,
        RUTAS_TIMEZONE: "UTC",
        RUTAS_BOOTSTRAP_TOKEN: db.config.bootstrapToken,
        ODOO_URL: "",
        ODOO_DATABASE: "",
        ODOO_EMAIL: "",
        ODOO_USERNAME: "",
        ODOO_API_KEY: "",
        ODOO_PASSWORD: "",
        ODOO_COMPANY_ID: "",
      },
    },
  );
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const ready = await fetch(`${origin}/api/ready`);
      if (ready.ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error("E2E_SERVER_NOT_READY");
}
async function stopApp() {
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((done) => {
    child.once("exit", () => done());
    child.kill();
  });
}
test.beforeAll(async () => {
  db = await startPostgres();
  nodePort = await freePort();
  origin = `http://127.0.0.1:${nodePort}`;
  await startApp();
});
test.afterAll(async () => {
  await stopApp();
  await db?.close();
});

test("setup, two sessions, shared draft, CSRF, accounts, revocation and restart", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const first = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await first.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin);
  await expect(page).toHaveURL(`${origin}/login`);
  const denied = await first.request.get(`${origin}/api/plans`);
  expect(denied.status()).toBe(401);
  expect((await first.request.get(`${origin}/api/maps/config`)).status()).toBe(
    401,
  );
  expect((await first.request.get(`${origin}/api/customers`)).status()).toBe(
    401,
  );
  expect(
    (await first.request.get(`${origin}/api/routing/settings`)).status(),
  ).toBe(401);
  expect(
    (
      await first.request.get(
        `${origin}/api/plans/00000000-0000-0000-0000-000000000000/optimization`,
      )
    ).status(),
  ).toBe(401);
  expect(
    (await first.request.get(`${origin}/api/customers/export`)).status(),
  ).toBe(401);
  expect(
    (
      await first.request.get(
        `${origin}/api/plans/00000000-0000-0000-0000-000000000000/export`,
      )
    ).status(),
  ).toBe(401);
  const csrf = await first.request.post(`${origin}/api/setup`, {
    data: {},
    headers: { Origin: "https://another.example" },
  });
  expect(csrf.status()).toBe(403);
  const noOrigin = await first.request.post(`${origin}/api/setup`, {
    data: {},
  });
  expect(noOrigin.status()).toBe(403);
  await page.goto(`${origin}/setup`);
  const rejectedSetup = await first.request.post(`${origin}/api/setup`, {
    headers: { Origin: origin },
    data: {
      token: db.config.bootstrapToken,
      name: "Rejected QA",
      login: "rejected-qa",
      password: password.slice(0, 5),
    },
  });
  expect(rejectedSetup.status()).toBe(400);
  expect(await rejectedSetup.json()).toMatchObject({
    error: "PASSWORD_POLICY",
  });
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveAttribute(
    "minlength",
    "6",
  );
  await page.getByLabel("Clave de instalación").fill(db.config.bootstrapToken);
  await page.getByLabel("Nombre completo").fill("Administrador QA");
  await page.getByLabel("Usuario", { exact: true }).fill(userLogin);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Crear administrador" }).click();
  await expect(page.getByRole("status")).toContainText("Cuenta creada");
  await page.goto(`${origin}/login`);
  await page.getByLabel("Usuario", { exact: true }).fill(userLogin);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  await expect(
    page.getByRole("heading", { name: "Planificar rutas", exact: true }),
  ).toBeVisible();
  const cookie = (await first.cookies()).find(
    (c) => c.name === "ana-rutas-local",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Strict");
  const depot = {
    depotAddress:
      "Calle 5 1106, Colonia Industrial, Guadalajara, Jalisco, México",
    depotLocation: {
      latitude: 20.624,
      longitude: -103.354,
      placeId: "e2e-depot",
    },
    expectedVersion: 0,
  };
  const deniedDepot = await first.request.put(
    `${origin}/api/routing/settings`,
    {
      headers: { Origin: "https://another.example" },
      data: depot,
    },
  );
  expect(deniedDepot.status()).toBe(403);
  expect(await deniedDepot.json()).toMatchObject({ error: "ORIGIN_DENIED" });
  expect(
    await (await first.request.get(`${origin}/api/routing/settings`)).json(),
  ).toMatchObject({
    depotLocation: null,
    version: 0,
  });
  const savedDepot = await first.request.put(`${origin}/api/routing/settings`, {
    headers: { Origin: origin },
    data: depot,
  });
  expect(savedDepot.status()).toBe(200);
  expect(await savedDepot.json()).toMatchObject({
    depotAddress: depot.depotAddress,
    depotLocation: depot.depotLocation,
    version: 1,
  });
  const staleDepot = await first.request.put(`${origin}/api/routing/settings`, {
    headers: { Origin: origin },
    data: depot,
  });
  expect(staleDepot.status()).toBe(409);
  const second = await browser.newContext();
  const other = await second.newPage();
  await other.goto(`${origin}/login`);
  await other.getByLabel("Usuario", { exact: true }).fill(userLogin);
  await other.getByLabel("Contraseña", { exact: true }).fill(password);
  await other.getByRole("button", { name: "Entrar al panel" }).click();
  await expect(
    other.getByRole("heading", { name: "Planificar rutas", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Nuevo borrador", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Nuevo borrador" }),
  ).toBeVisible();
  await page.getByLabel("Fecha de operación").fill("2026-10-10");
  await page
    .getByLabel("Nombre del plan", { exact: true })
    .fill("Plan de validación");
  await page.getByRole("button", { name: "Crear borrador" }).click();
  await expect(
    page.getByRole("heading", { name: "Plan de validación" }),
  ).toBeVisible();
  await expect(
    page.getByText("Sin pedidos cargados", { exact: true }),
  ).toBeVisible();
  const originButton = page.getByRole("button", {
    name: "Configurar punto de salida",
    exact: true,
  });
  await originButton.click();
  const originDialog = page.getByRole("dialog", { name: "Punto de salida" });
  await expect(originDialog.getByLabel("Dirección de salida")).toHaveValue(
    depot.depotAddress,
  );
  await expect(originDialog).toContainText("Escribe el domicilio completo");
  await expect(originDialog).toContainText("20.624000, -103.354000");
  await page.keyboard.press("Escape");
  await expect(originDialog).toHaveCount(0);
  await expect(originButton).toBeFocused();
  await other.getByRole("button", { name: "Actualizar", exact: true }).click();
  await expect(other.getByLabel("Abrir borrador")).toContainText(
    "Plan de validación",
  );
  const plansBefore = await (
    await first.request.get(`${origin}/api/plans`)
  ).json();
  const savedPlan = plansBefore.find(
    (plan: { label: string }) => plan.label === "Plan de validación",
  );
  const emptyOptimization = await first.request.post(
    `${origin}/api/plans/${savedPlan.id}/optimization`,
    {
      headers: { Origin: origin },
      data: { expectedVersion: savedPlan.version },
    },
  );
  expect(emptyOptimization.status()).toBe(409);
  expect(await emptyOptimization.json()).toMatchObject({
    error: "ROUTING_VEHICLES_REQUIRED",
  });
  const rename = page.getByRole("button", {
    name: "Cambiar nombre",
    exact: true,
  });
  const nameInput = page.getByLabel("Nombre del borrador", { exact: true });
  const saveName = page.getByRole("button", {
    name: "Guardar cambios",
    exact: true,
  });
  const patchRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      new URL(request.url()).pathname.startsWith("/api/plans/")
    ) {
      patchRequests.push(request.url());
    }
  });
  await expect(nameInput).toHaveCount(0);
  await expect(saveName).toHaveCount(0);
  await rename.click();
  await expect(nameInput).toBeFocused();
  await expect(nameInput).toHaveValue("Plan de validación");
  await expect(saveName).toBeDisabled();
  await nameInput.fill("   ");
  await expect(saveName).toBeDisabled();
  await nameInput.fill("Edición descartada");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(rename).toBeFocused();
  await expect(nameInput).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Plan de validación", exact: true }),
  ).toBeVisible();
  await rename.click();
  await expect(nameInput).toHaveValue("Plan de validación");
  await nameInput.fill("Otra edición descartada");
  await nameInput.press("Escape");
  await expect(rename).toBeFocused();
  await expect(nameInput).toHaveCount(0);
  expect(patchRequests).toHaveLength(0);

  await rename.click();
  await nameInput.fill("Reparto del martes");
  await nameInput.press("Enter");
  await expect(page.getByRole("status")).toContainText(
    "Nombre del borrador actualizado",
  );
  await expect(
    page.getByRole("heading", { name: "Reparto del martes", exact: true }),
  ).toBeVisible();
  await expect(nameInput).toHaveCount(0);
  expect(patchRequests).toHaveLength(1);
  const renamedPlans = await (
    await first.request.get(`${origin}/api/plans`)
  ).json();
  expect(
    renamedPlans.find((plan: { id: string }) => plan.id === savedPlan.id),
  ).toMatchObject({
    id: savedPlan.id,
    service_date: savedPlan.service_date,
    label: "Reparto del martes",
    version: savedPlan.version + 1,
  });

  // The second browser still has the previous version: exercise a real 409, no request mocks.
  await other.getByLabel("Abrir borrador").selectOption(savedPlan.id);
  await other
    .getByRole("button", { name: "Cambiar nombre", exact: true })
    .click();
  await other
    .getByLabel("Nombre del borrador")
    .fill("No sobrescribir la otra sesión");
  const currentPlan = (
    await (await first.request.get(`${origin}/api/plans`)).json()
  ).find((plan: { id: string }) => plan.id === savedPlan.id);
  const concurrent = await first.request.patch(
    `${origin}/api/plans/${savedPlan.id}`,
    {
      headers: { Origin: origin },
      data: {
        label: "Reparto del martes",
        expectedVersion: currentPlan.version,
      },
    },
  );
  expect(concurrent.status()).toBe(200);
  const conflict = other.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().endsWith(`/api/plans/${savedPlan.id}`),
  );
  await other
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  expect((await conflict).status()).toBe(409);
  await expect(
    other
      .getByRole("alert")
      .filter({ hasText: "Otra persona modificó este registro" }),
  ).toBeVisible();
  await expect(other.getByLabel("Nombre del borrador")).toHaveValue(
    "No sobrescribir la otra sesión",
  );
  await other.getByRole("button", { name: "Cancelar", exact: true }).click();
  await other.getByRole("button", { name: "Actualizar", exact: true }).click();
  await other.getByLabel("Abrir borrador").selectOption(savedPlan.id);
  await expect(
    other.getByRole("heading", { name: "Reparto del martes", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Nuevo borrador", exact: true })
    .click();
  await page.getByLabel("Fecha de operación").fill("2026-10-11");
  await page.getByLabel("Nombre del plan", { exact: true }).fill("Otro día QA");
  await page
    .getByRole("button", { name: "Crear borrador", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Otro día QA", exact: true }),
  ).toBeVisible();
  await rename.click();
  await nameInput.fill("No trasladar a otro borrador");
  await page.getByLabel("Abrir borrador").selectOption(savedPlan.id);
  await expect(nameInput).toHaveCount(0);
  await rename.click();
  await expect(nameInput).toHaveValue("Reparto del martes");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(patchRequests).toHaveLength(1);
  await page
    .getByLabel("Abrir borrador")
    .selectOption({ label: "Otro día QA · 2026-10-11" });
  const disposablePlan = (
    await (await first.request.get(`${origin}/api/plans`)).json()
  ).find((plan: { label: string }) => plan.label === "Otro día QA");
  const deniedDelete = await first.request.delete(
    `${origin}/api/plans/${disposablePlan.id}`,
    { data: { expectedVersion: disposablePlan.version } },
  );
  expect(deniedDelete.status()).toBe(403);
  const deletePlanButton = page.getByRole("button", {
    name: "Borrar plan",
    exact: true,
  });
  await deletePlanButton.click();
  const deletePlanDialog = page.getByRole("dialog", { name: "Borrar plan" });
  await expect(deletePlanDialog).toContainText("Otro día QA · 2026-10-11");
  await page.screenshot({
    path: "reports/screenshots/delete-plan-confirmation.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(deletePlanDialog).toHaveCount(0);
  expect(
    (await (await first.request.get(`${origin}/api/plans`)).json()).some(
      (plan: { id: string }) => plan.id === disposablePlan.id,
    ),
  ).toBe(true);
  await deletePlanButton.click();
  const deleteResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().endsWith(`/api/plans/${disposablePlan.id}`),
  );
  await deletePlanDialog
    .getByRole("button", { name: "Borrar plan", exact: true })
    .click();
  expect((await deleteResponse).status()).toBe(200);
  await expect(deletePlanDialog).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Otro día QA se borró");
  await expect(page.getByLabel("Abrir borrador")).not.toContainText(
    "Otro día QA",
  );
  await expect(page.getByLabel("Abrir borrador")).toHaveValue(savedPlan.id);
  await expect(
    page.getByRole("heading", { name: "Reparto del martes", exact: true }),
  ).toBeVisible();
  await mkdir("reports/screenshots", { recursive: true });
  await page.screenshot({
    path: "reports/screenshots/panel-desktop.png",
    fullPage: true,
  });
  for (const width of [375, 768, 940, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const createButton = page.getByRole("button", {
      name: "Nuevo borrador",
      exact: true,
    });
    const controlHeight = (await createButton.boundingBox())!.height;
    expect(controlHeight).toBeGreaterThanOrEqual(width <= 720 ? 44 : 34);
    expect(controlHeight).toBeLessThanOrEqual(width <= 720 ? 48 : 36);
    await expect(page.locator(".planner-command-bar h1")).toHaveCSS(
      "font-size",
      "18px",
    );
    await expect(page.locator(".draft-title h2")).toHaveCSS(
      "font-size",
      "14px",
    );
    await expect(page.locator(".panel").first()).toHaveCSS(
      "border-radius",
      "10px",
    );
    await page.screenshot({
      path: `reports/screenshots/compact-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await rename.click();
    await expect(nameInput).toBeFocused();
    expect((await rename.boundingBox())!.height).toBeGreaterThanOrEqual(
      width <= 720 ? 44 : 30,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (width === 375 || width === 1440) {
      await page.screenshot({
        path: `reports/screenshots/rename-open-${width}.png`,
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  }
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.screenshot({
    path: "reports/screenshots/panel-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(
    page.getByRole("button", { name: "Conexión con Odoo", exact: true }),
  ).toHaveCount(0);
  const internalOdooConnector = await first.request.get(`${origin}/api/odoo`);
  expect(internalOdooConnector.status()).toBe(200);
  expect(await internalOdooConnector.json()).toMatchObject({
    configured: false,
  });
  await page
    .getByRole("button", { name: "Usuarios y accesos", exact: true })
    .click();
  await page.getByLabel("Nombre completo").fill("Segunda cuenta QA");
  await expect(page.getByLabel("Contraseña", { exact: true })).toHaveAttribute(
    "minlength",
    "6",
  );
  const rejectedUser = await first.request.post(`${origin}/api/users`, {
    headers: { Origin: origin },
    data: {
      name: "Rejected QA",
      login: "rejected-qa",
      password: password.slice(0, 5),
    },
  });
  expect(rejectedUser.status()).toBe(400);
  expect(await rejectedUser.json()).toMatchObject({ error: "PASSWORD_POLICY" });
  const accounts = await (
    await first.request.get(`${origin}/api/users`)
  ).json();
  expect(
    accounts.some(
      (account: { login: string }) => account.login === "rejected-qa",
    ),
  ).toBe(false);
  await page.getByLabel("Usuario", { exact: true }).fill("qa-second-browser");
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Cuenta creada");
  await page.screenshot({
    path: "reports/screenshots/compact-users.png",
    fullPage: true,
  });
  const third = await browser.newContext();
  const staff = await third.newPage();
  await staff.goto(`${origin}/login`);
  await staff.getByLabel("Usuario", { exact: true }).fill("qa-second-browser");
  await staff.getByLabel("Contraseña", { exact: true }).fill(password);
  await staff.getByRole("button", { name: "Entrar al panel" }).click();
  await expect(
    staff.getByRole("heading", { name: "Planificar rutas", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("row")
    .filter({ hasText: "Segunda cuenta QA" })
    .getByRole("button", { name: "Desactivar" })
    .click();
  await expect(page.getByRole("status")).toContainText("sesiones revocadas");
  expect((await third.request.get(`${origin}/api/plans`)).status()).toBe(401);
  const fleet = await fleetFlow(page, first, second, origin);
  await page
    .getByRole("button", { name: "Planificar rutas", exact: true })
    .click();
  await page.getByLabel("Abrir borrador").selectOption(savedPlan.id);
  await page
    .getByRole("button", { name: "Cargar pedidos de Odoo", exact: true })
    .click();
  const loadDialog = page.getByRole("dialog", {
    name: "Cargar pedidos de Odoo",
  });
  await expect(loadDialog.getByText("2 camionetas disponibles")).toBeVisible();
  await expect(
    loadDialog.getByText(
      "La fecha seleccionada traerá los pedidos validados.",
      { exact: false },
    ),
  ).toBeVisible();
  const validationDate = loadDialog.getByLabel(
    "Fecha de validación de pedidos",
    { exact: true },
  );
  await expect(validationDate).toHaveCount(1);
  await expect(validationDate).toHaveValue(
    new Date().toISOString().slice(0, 10),
  );
  await expect(loadDialog.getByLabel("Desde", { exact: true })).toHaveCount(0);
  await expect(loadDialog.getByLabel("Hasta", { exact: true })).toHaveCount(0);
  await expect(
    loadDialog.getByText("Cargar pedido manual fuera de fecha", {
      exact: true,
    }),
  ).toBeVisible();
  const firstManualOrder = loadDialog.getByLabel(
    "Número del folio S, pedido 1",
    { exact: true },
  );
  await firstManualOrder.fill("00001");
  await loadDialog
    .getByRole("button", { name: "+ Agregar pedido", exact: true })
    .click();
  const secondManualOrder = loadDialog.getByLabel(
    "Número del folio S, pedido 2",
    { exact: true },
  );
  await secondManualOrder.fill("S00003");
  await expect(firstManualOrder).toHaveValue("00001");
  await expect(secondManualOrder).toHaveValue("00003");
  await page.screenshot({
    path: "reports/screenshots/load-orders-single-date.png",
    fullPage: true,
  });
  await validationDate.fill(savedPlan.service_date);
  await expect(validationDate).toHaveValue(savedPlan.service_date);
  await loadDialog.getByRole("checkbox").first().check();
  await expect(
    loadDialog.getByRole("button", {
      name: "Confirmar pedidos",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    loadDialog.getByRole("button", {
      name: "Guardar camionetas",
      exact: true,
    }),
  ).toHaveCount(0);
  const mutatingOrderRequests: Array<{ method: string; path: string }> = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      ["POST", "PUT", "DELETE"].includes(request.method()) &&
      path.startsWith(`/api/plans/${savedPlan.id}`)
    )
      mutatingOrderRequests.push({ method: request.method(), path });
  });
  const datedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/plans/${savedPlan.id}/orders`,
  );
  await loadDialog
    .getByRole("button", { name: "Cargar pedidos", exact: true })
    .click();
  expect((await datedResponse).status()).toBe(503);
  await expect(loadDialog.getByRole("alert")).toContainText(
    "Falta completar la configuración",
  );
  expect(mutatingOrderRequests).toEqual([
    { method: "PUT", path: `/api/plans/${savedPlan.id}/vehicles` },
    { method: "POST", path: `/api/plans/${savedPlan.id}/orders` },
  ]);
  await expect(
    loadDialog.getByRole("button", { name: "Cargar pedidos", exact: true }),
  ).toBeVisible();
  const manualRequestStart = mutatingOrderRequests.length;
  const manualResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/plans/${savedPlan.id}/orders/manual`,
  );
  await loadDialog
    .getByRole("button", { name: "Confirmar pedidos", exact: true })
    .click();
  expect((await manualResponse).status()).toBe(503);
  await expect(loadDialog.getByRole("alert")).toContainText(
    "Falta completar la configuración",
  );
  expect(mutatingOrderRequests.slice(manualRequestStart)).toEqual([
    { method: "POST", path: `/api/plans/${savedPlan.id}/orders/manual` },
  ]);
  await expect(
    loadDialog.getByRole("button", { name: "Cargar pedidos", exact: true }),
  ).toBeVisible();
  await loadDialog
    .getByRole("button", { name: "Cerrar carga", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Añadir camioneta", exact: true })
    .click();
  const addVehicleDialog = page.getByRole("dialog", {
    name: "Añadir camionetas al plan",
  });
  await expect(
    addVehicleDialog.getByText("1 camioneta disponible para agregar", {
      exact: false,
    }),
  ).toBeVisible();
  await addVehicleDialog.getByRole("checkbox").check();
  await addVehicleDialog
    .getByRole("button", { name: "Añadir seleccionadas", exact: true })
    .click();
  await expect(addVehicleDialog).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "1 camioneta añadida al plan",
  );
  await expect(page.locator(".order-lane")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Añadir camioneta", exact: true })
    .click();
  await expect(
    addVehicleDialog.getByText(
      "Todas las camionetas registradas ya pertenecen a este plan.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    addVehicleDialog.getByRole("button", {
      name: "Añadir seleccionadas",
      exact: true,
    }),
  ).toBeDisabled();
  await addVehicleDialog
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  const actorId = (
    await db.pool.query("SELECT id FROM route_users WHERE login=$1", [
      userLogin,
    ])
  ).rows[0].id;
  const recoverableOrderPage = {
    fingerprint: "e2e-source",
    shipments: [
      {
        pickingId: 500,
        pickingName: "WH/OUT/00500",
        orderId: 500,
        orderName: "S00500",
        partnerId: 11,
        customerName: "Fonda Martha",
        address: "Av. Guadalupe 851, Guadalajara",
        validatedAt: "2026-10-09T18:00:00.000Z",
        promisedAt: null,
        backorderId: null,
        lines: [
          {
            moveId: 5000,
            productId: 260,
            name: "Producto de validación",
            quantity: 4,
            unit: "kg",
            pickerNote: "Maduro; separar bolsas <b>sin interpretar HTML</b>",
          },
        ],
      },
    ],
    nextCursor: 500,
    ceiling: 500,
    hasMore: false,
    inspected: 1,
    excluded: 0,
  };
  await persistImportPage(db.pool, actorId, savedPlan.id, recoverableOrderPage);
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await expect(page.getByText("Fonda Martha", { exact: true })).toBeVisible();
  const fondaCard = page.locator(".shipment-card").filter({
    has: page.getByText("Fonda Martha", { exact: true }),
  });
  await expect(
    fondaCard.getByText("Av. Guadalupe 851, Guadalajara"),
  ).toHaveCount(0);
  await fondaCard
    .getByRole("button", {
      name: "Mostrar detalles de Fonda Martha S00500",
      exact: true,
    })
    .click();
  await expect(
    fondaCard.getByText("Av. Guadalupe 851, Guadalajara"),
  ).toBeVisible();
  await page.locator(".shipment-card summary").click();
  await expect(page.locator(".picker-note")).toHaveText(
    "Maduro; separar bolsas <b>sin interpretar HTML</b>",
  );
  await expect(page.locator(".picker-note b")).toHaveCount(0);
  const openMap = page.getByRole("button", {
    name: "Ver mapa de rutas",
    exact: true,
  });
  await openMap.click();
  await expect(page.getByRole("dialog")).toContainText(
    "Mapa pendiente de activar",
  );
  await page.keyboard.press("Escape");
  await expect(openMap).toBeFocused();
  expect(
    await (await first.request.get(`${origin}/api/maps/config`)).json(),
  ).toEqual({ configured: false });
  await expect(page.getByText("Sin horario", { exact: true })).toBeVisible();
  await page
    .getByLabel("Camioneta para S00500 WH/OUT/00500")
    .selectOption({ label: "Unidad QA 1" });
  await expect(page.getByRole("status")).toContainText(
    "Asignación y orden guardados",
  );
  await expect(page.getByText("Fonda Martha", { exact: true })).toBeVisible();
  await fondaCard
    .getByRole("button", {
      name: "Ocultar detalles de Fonda Martha S00500",
      exact: true,
    })
    .click();
  const removeOrder = fondaCard.getByRole("button", {
    name: "Eliminar pedido S00500 del ruteo",
    exact: true,
  });
  await removeOrder.click();
  const removeOrderDialog = page.getByRole("dialog", {
    name: "Eliminar pedido del ruteo",
  });
  await expect(removeOrderDialog).toContainText(
    "¿Desea eliminar este pedido del ruteo?",
  );
  await expect(removeOrderDialog).toContainText(
    "S00500 · Surtido WH/OUT/00500",
  );
  await page.screenshot({
    path: "reports/screenshots/remove-order-confirmation.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(removeOrderDialog).toHaveCount(0);
  await expect(removeOrder).toBeFocused();
  await removeOrder.click();
  await removeOrderDialog
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await expect(removeOrder).toBeFocused();
  await removeOrder.click();
  await removeOrderDialog
    .getByRole("button", { name: "Aceptar y eliminar", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "S00500 se eliminó del ruteo",
  );
  await expect(fondaCard).toHaveCount(0);
  await persistImportPage(db.pool, actorId, savedPlan.id, recoverableOrderPage);
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await expect(page.getByText("Fonda Martha", { exact: true })).toBeVisible();
  await fondaCard
    .getByRole("button", {
      name: "Mostrar detalles de Fonda Martha S00500",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Camioneta para S00500 WH/OUT/00500")
    .selectOption({ label: "Unidad QA 1" });
  await expect(page.getByRole("status")).toContainText(
    "Asignación y orden guardados",
  );
  await fondaCard
    .getByRole("button", {
      name: "Ocultar detalles de Fonda Martha S00500",
      exact: true,
    })
    .click();
  const removeUnit = page.getByRole("button", {
    name: "Quitar Unidad QA 1 del plan",
    exact: true,
  });
  await removeUnit.click();
  const removeDialog = page.getByRole("dialog", {
    name: "Quitar camioneta del plan",
  });
  await expect(removeDialog).toContainText("Su pedido pasará a");
  await expect(removeDialog).toContainText("Pedidos sin asignar");
  await page.screenshot({
    path: "reports/screenshots/remove-vehicle-confirmation.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(removeDialog).toHaveCount(0);
  await expect(removeUnit).toBeFocused();
  await removeUnit.click();
  await removeDialog
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  await expect(removeUnit).toBeFocused();
  await expect(removeUnit).toBeVisible();
  await removeUnit.click();
  await removeDialog
    .getByRole("button", { name: "Quitar camioneta", exact: true })
    .click();
  await expect(removeDialog).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "1 pedido pasó a Sin asignar",
  );
  await expect(removeUnit).toHaveCount(0);
  await expect(page.locator(".shipment-list").first()).toContainText(
    "Fonda Martha",
  );
  await expect
    .poll(async () => {
      const current = await orderBoard(db.pool, savedPlan.id);
      return current.shipments.find(
        (shipment) => shipment.orderName === "S00500",
      )?.vehicle_id;
    })
    .toBeNull();
  const initialBoard = await orderBoard(db.pool, savedPlan.id);
  await persistCustomerPage(db.pool, actorId, {
    fingerprint: "e2e-source",
    customers: [
      {
        partnerId: 11,
        parentId: null,
        parentName: null,
        commercialPartnerId: 11,
        commercialName: "Café E2E Odoo",
        companyId: null,
        type: "contact",
        isCompany: true,
        active: true,
        name: "Café E2E Odoo",
        reference: "CLIENTE-E2E",
        phone: null,
        mobile: "3312345678",
        address: "Av. Vallarta 100, Guadalajara",
      },
      {
        partnerId: 12,
        parentId: null,
        parentName: null,
        commercialPartnerId: 12,
        commercialName: "Cliente prioridad media",
        companyId: null,
        type: "contact",
        isCompany: true,
        active: true,
        name: "Cliente prioridad media",
        reference: "PRIORIDAD-MEDIA-E2E",
        phone: "3311111111",
        mobile: null,
        address: "Av. México 12, Guadalajara",
      },
    ],
    nextCursor: 12,
    ceiling: 12,
    hasMore: false,
  });
  await db.pool.query(
    `UPDATE route_customers
     SET priority=CASE odoo_partner_id WHEN 11 THEN 'high' ELSE 'medium' END
     WHERE source=$1 AND odoo_partner_id IN (11,12)`,
    ["e2e-source"],
  );
  const chosenVehicles = [...initialBoard.vehicles.map((v) => v.id)];
  for (let i = 2; i <= 7; i++) {
    const vehicle = await createVehicle(db.pool, actorId, {
      id: randomUUID(),
      name: `Camioneta de prueba ${i}`,
      brand: "QA",
      model: "2026",
      plate: `QA-STRESS-${i}`,
      mileage: 0,
      fuel: "Diésel",
      available: true,
    });
    chosenVehicles.push(vehicle.id);
  }
  await selectPlanVehicles(db.pool, actorId, savedPlan.id, {
    vehicleIds: chosenVehicles,
    expectedVersion: initialBoard.plan.version,
  });
  const exemplar = initialBoard.shipments[0];
  await persistImportPage(db.pool, actorId, savedPlan.id, {
    fingerprint: "e2e-source",
    shipments: Array.from({ length: 24 }, (_, i) => ({
      pickingId: 600 + i,
      pickingName: `WH/OUT/${600 + i}`,
      orderId: 600 + i,
      orderName: `S${600 + i}`,
      partnerId: i % 2 === 0 ? 11 : 12,
      customerName: `Pedido QA ${i + 1}`,
      address: exemplar.address,
      validatedAt: exemplar.validatedAt,
      promisedAt: null,
      backorderId: null,
      lines: exemplar.lines,
    })),
    nextCursor: 624,
    ceiling: 624,
    hasMore: false,
    inspected: 24,
    excluded: 0,
  });
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await expect(page.locator(".order-lane")).toHaveCount(8);
  const highPriority = page.locator(".shipment-priority.high").first();
  const mediumPriority = page.locator(".shipment-priority.medium").first();
  await expect(highPriority).toHaveText("Prioridad alta");
  await expect(highPriority).toHaveCSS("color", "rgb(255, 214, 122)");
  await expect(highPriority).toHaveCSS("background-color", "rgb(51, 39, 17)");
  await expect(mediumPriority).toHaveText("Prioridad media");
  await expect(mediumPriority).toHaveCSS("color", "rgb(181, 216, 255)");
  await expect(mediumPriority).toHaveCSS("background-color", "rgb(16, 41, 59)");
  await page.getByRole("button", { name: "Cerrar menú", exact: true }).click();
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.locator(".shipment-card details[open]").evaluateAll((details) => {
    for (const detail of details) detail.removeAttribute("open");
  });
  for (const width of [768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 768 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeLessThanOrEqual(768);
    const dimensions = await page.evaluate(async () => {
      const list = document.querySelector<HTMLElement>(".shipment-list")!;
      const lanes = document.querySelector<HTMLElement>(".orders-lanes")!;
      list.scrollTop = 0;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const visibleCards = Array.from(
        list.querySelectorAll<HTMLElement>(".shipment-card"),
      ).filter((card) => {
        const cardBox = card.getBoundingClientRect();
        const listBox = list.getBoundingClientRect();
        return cardBox.top >= listBox.top && cardBox.bottom <= listBox.bottom;
      }).length;
      const maxCardHeight = Math.max(
        ...Array.from(list.querySelectorAll<HTMLElement>(".shipment-card"))
          .slice(0, 4)
          .map((card) => card.getBoundingClientRect().height),
      );
      const oldY = window.scrollY;
      list.scrollTop = 350;
      return {
        visibleCards,
        maxCardHeight,
        listScroll: list.scrollTop,
        pageY: window.scrollY - oldY,
        pageHeight: document.documentElement.scrollHeight,
        height: window.innerHeight,
        lanesHeight: lanes.getBoundingClientRect().height,
        lanesTop: lanes.getBoundingClientRect().top,
      };
    });
    expect(dimensions.listScroll).toBeGreaterThan(0);
    expect(dimensions.pageY).toBe(0);
    expect(dimensions.pageHeight).toBeLessThanOrEqual(dimensions.height);
    expect(dimensions.lanesHeight).toBeGreaterThan(250);
    expect(dimensions.lanesTop).toBeLessThan(180);
    expect(dimensions.visibleCards).toBeGreaterThanOrEqual(6);
    expect(dimensions.maxCardHeight).toBeLessThanOrEqual(80);
    await page.screenshot({
      path: `reports/screenshots/planner-seven-${width}.png`,
      fullPage: true,
    });
  }
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `reports/screenshots/orders-board-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
  await persistCustomerPage(db.pool, actorId, {
    fingerprint: "e2e-source",
    customers: [
      {
        partnerId: 11,
        parentId: null,
        parentName: null,
        commercialPartnerId: 11,
        commercialName: "Café E2E Odoo",
        companyId: null,
        type: "contact",
        isCompany: true,
        active: true,
        name: "Café E2E Odoo",
        reference: "CLIENTE-E2E",
        phone: null,
        mobile: "3312345678",
        address: "Av. Vallarta 100, Guadalajara",
      },
    ],
    nextCursor: 11,
    ceiling: 11,
    hasMore: false,
  });
  const securedCustomer = (
    await listCustomers(db.pool, {
      archived: false,
      query: "CLIENTE-E2E",
      limit: 1,
    })
  ).customers[0];
  const deniedCustomerUpdate = await first.request.patch(
    `${origin}/api/customers/${securedCustomer.id}`,
    {
      headers: { Origin: "https://another.example" },
      data: {},
    },
  );
  expect(deniedCustomerUpdate.status()).toBe(403);
  expect(
    (
      await listCustomers(db.pool, {
        archived: false,
        query: "CLIENTE-E2E",
        limit: 1,
      })
    ).customers[0].version,
  ).toBe(securedCustomer.version);
  await page
    .getByRole("button", { name: "Clientes y horarios", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Clientes y horarios", exact: true }),
  ).toBeVisible();
  await page
    .getByPlaceholder("Buscar cliente, Odoo, teléfono o matriz…")
    .fill("cafe e2e");
  await expect(page.getByLabel("Nombre en Odoo", { exact: true })).toHaveValue(
    "Café E2E Odoo",
  );
  await page.getByLabel("Cliente", { exact: true }).fill("Sucursal E2E");
  await page
    .getByRole("button", { name: "Añadir ventana", exact: true })
    .click();
  await page.getByLabel("Desde", { exact: true }).fill("11:00");
  await page.getByLabel("Hasta", { exact: true }).fill("13:00");
  await expect(page.getByLabel("Desde", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await expect(page.getByLabel("Desde", { exact: true })).toHaveValue("11:00");
  await expect(page.getByLabel("Hasta", { exact: true })).toHaveValue("13:00");
  const archiveDesktopBox = await page
    .getByRole("button", { name: "Archivar", exact: true })
    .boundingBox();
  const windowTrashDesktopBox = await page
    .getByRole("button", { name: "Quitar ventana 1", exact: true })
    .boundingBox();
  expect(archiveDesktopBox?.height).toBeLessThanOrEqual(28);
  expect(windowTrashDesktopBox?.width).toBeLessThanOrEqual(28);
  expect(windowTrashDesktopBox?.height).toBeLessThanOrEqual(28);
  await page
    .getByLabel("Domicilio de entrega", { exact: true })
    .fill("Calle Reforma 20, Guadalajara");
  await page.getByRole("button", { name: "Alta", exact: true }).click();
  await page
    .getByRole("button", { name: "Guardar cambios", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Cambios del cliente guardados",
  );
  await expect(
    page.getByText("Lun/Mar/Mié/Jue/Vie 11:00–13:00", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Exportar Excel", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Importar Excel", { exact: true })).toHaveCount(
    0,
  );
  const splitListWidth = await page
    .locator(".customer-list")
    .evaluate((element) => element.getBoundingClientRect().width);
  await page
    .getByLabel("Cliente", { exact: true })
    .fill("Cambio local que no se guardará");
  let dismissedCloseMessage = "";
  page.once("dialog", (dialog) => {
    dismissedCloseMessage = dialog.message();
    void dialog.dismiss();
  });
  await page.getByRole("button", { name: "Ocultar", exact: true }).click();
  expect(dismissedCloseMessage).toContain("cambios sin guardar");
  await expect(page.getByLabel("Cliente", { exact: true })).toHaveValue(
    "Cambio local que no se guardará",
  );
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Ocultar", exact: true }).click();
  await expect(page.locator(".customer-editor")).toBeHidden();
  const fullListWidth = await page
    .locator(".customer-list")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(fullListWidth).toBeGreaterThan(splitListWidth + 250);
  await page.screenshot({
    path: "reports/screenshots/customers-editor-hidden-1440.png",
    fullPage: true,
  });
  await page
    .getByPlaceholder("Buscar cliente, Odoo, teléfono o matriz…")
    .fill("cafe e2e ");
  await page.waitForTimeout(350);
  await expect(page.locator(".customer-editor")).toBeHidden();
  await page.locator(".customer-row").first().click();
  await expect(page.getByLabel("Cliente", { exact: true })).toHaveValue(
    "Sucursal E2E",
  );
  const customerExport = await first.request.get(
    `${origin}/api/customers/export?q=e2e&archived=false`,
  );
  expect(customerExport.status()).toBe(200);
  expect(customerExport.headers()["content-type"]).toContain(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  expect((await customerExport.body()).subarray(0, 2).toString()).toBe("PK");
  const planExport = await first.request.get(
    `${origin}/api/plans/${savedPlan.id}/export`,
  );
  expect(planExport.status()).toBe(200);
  expect((await planExport.body()).subarray(0, 2).toString()).toBe("PK");
  await page.getByRole("button", { name: "Archivar", exact: true }).click();
  const archiveDialog = page.getByRole("dialog", { name: "Archivar cliente" });
  await expect(archiveDialog).toBeVisible();
  await archiveDialog
    .getByRole("button", { name: "Archivar", exact: true })
    .click();
  await page.getByRole("tab", { name: /Archivados/ }).click();
  await expect(
    page.getByText("Sucursal E2E", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restaurar", exact: true }).click();
  const restoreDialog = page.getByRole("dialog", { name: "Restaurar cliente" });
  await restoreDialog
    .getByRole("button", { name: "Restaurar", exact: true })
    .click();
  await page.getByRole("tab", { name: /Activos/ }).click();
  await expect(
    page.getByText("Sucursal E2E", { exact: true }).first(),
  ).toBeVisible();
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 375) {
      const archiveTouchBox = await page
        .getByRole("button", { name: "Archivar", exact: true })
        .boundingBox();
      const windowTrashTouchBox = await page
        .getByRole("button", { name: "Quitar ventana 1", exact: true })
        .boundingBox();
      expect(archiveTouchBox?.height).toBeGreaterThanOrEqual(44);
      expect(windowTrashTouchBox?.width).toBeGreaterThanOrEqual(44);
      expect(windowTrashTouchBox?.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `reports/screenshots/customers-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Auditoría", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Creó un borrador", exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("cell", { name: "Modificó un borrador", exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("cell", { name: "Borró un borrador", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(`${origin}/login`);
  expect((await second.request.get(`${origin}/api/plans`)).status()).toBe(200);
  await stopApp();
  await startApp();
  expect(await (await second.request.get(fleet.url)).body()).toEqual(
    fleet.initialBytes,
  );
  await other.reload();
  await expect(
    other.getByRole("heading", { name: "Planificar rutas", exact: true }),
  ).toBeVisible();
  await expect(other.getByLabel("Abrir borrador")).toContainText(
    "Reparto del martes",
  );
  expect(pageErrors).toEqual([]);
  await first.close();
  await second.close();
  await third.close();
});
