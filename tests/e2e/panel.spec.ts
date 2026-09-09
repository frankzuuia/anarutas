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
      .filter({ hasText: "Otra persona modificó este borrador" }),
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
  await loadDialog.getByRole("checkbox").first().check();
  await loadDialog
    .getByRole("button", { name: "Guardar camionetas", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Camionetas del día guardadas",
  );
  const actorId = (
    await db.pool.query("SELECT id FROM route_users WHERE login=$1", [
      userLogin,
    ])
  ).rows[0].id;
  await persistImportPage(db.pool, actorId, savedPlan.id, {
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
  });
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
  await fondaCard.dragTo(page.locator(".shipment-list").first());
  await expect(page.getByRole("status")).toContainText(
    "Asignación y orden guardados",
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
      partnerId: 11,
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
  await page.getByRole("button", { name: "Auditoría", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Creó un borrador", exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("cell", { name: "Modificó un borrador", exact: true }),
  ).toHaveCount(2);
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
