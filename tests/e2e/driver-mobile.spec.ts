import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { startPostgres, freePort } from "../helpers/postgres";
import { bootstrap } from "../../src/core/auth";
import {
  assignDriver,
  createDriver,
  createVehicle,
} from "../../src/core/fleet";
import { createPlan } from "../../src/core/plans";
import {
  orderBoard,
  persistImportPage,
  selectPlanVehicles,
} from "../../src/core/orders";
import { mobileChallengeMessage } from "../../src/core/driver-mobile-auth";
import type { SourceShipment } from "../../src/core/orders-contract";

let db: Awaited<ReturnType<typeof startPostgres>>;
let server: ChildProcess;
let origin: string;
let driverId: string;
let planId: string;
const phone = "3312345678";
const pin = "4821";
const adminLogin = `mobile-http-${randomUUID()}`;
const adminPassword = randomUUID();
const pepper = randomBytes(48).toString("hex");

function shipment(index: number): SourceShipment {
  return {
    pickingId: index,
    pickingName: `WH/OUT/${index}`,
    orderId: index,
    orderName: `S${index}`,
    partnerId: index,
    customerName: `Cliente ${index}`,
    address: `Calle ${index}, Guadalajara`,
    validatedAt: "2026-09-20T12:00:00.000Z",
    promisedAt: null,
    backorderId: null,
    lines: [
      {
        moveId: index * 10,
        productId: index,
        name: `Producto ${index}`,
        quantity: 2,
        unit: "kg",
      },
    ],
  };
}

test.beforeAll(async () => {
  db = await startPostgres();
  const admin = await bootstrap(db.pool, db.config, {
    token: db.config.bootstrapToken,
    name: "Administrador móvil QA",
    login: adminLogin,
    password: adminPassword,
  });
  const first = await createDriver(db.pool, admin.id, {
    id: randomUUID(),
    name: "Chofer HTTP A",
    phone,
    emergency_name: "",
    emergency_phone: "",
    blood_type: "",
    active: true,
  });
  const second = await createDriver(db.pool, admin.id, {
    id: randomUUID(),
    name: "Chofer HTTP B",
    phone: "3312345679",
    emergency_name: "",
    emergency_phone: "",
    blood_type: "",
    active: true,
  });
  driverId = first.id;
  const vehicles = [];
  for (const [index, driver] of [first, second].entries()) {
    const vehicle = await createVehicle(db.pool, admin.id, {
      id: randomUUID(),
      name: `HTTP camioneta ${index + 1}`,
      brand: "QA",
      model: "QA",
      plate: `HT-${index + 1}-${randomUUID().slice(0, 4)}`,
      mileage: 1,
      fuel: "Gasolina",
      available: true,
    });
    await assignDriver(db.pool, admin.id, vehicle.id, {
      driver_id: driver.id,
      expectedVersion: vehicle.version,
    });
    vehicles.push(vehicle);
  }
  const plan = await createPlan(db.pool, admin.id, {
    date: "2026-09-21",
    label: "Contrato HTTP móvil",
  });
  planId = plan.id;
  await selectPlanVehicles(db.pool, admin.id, plan.id, {
    vehicleIds: vehicles.map((vehicle) => vehicle.id),
    expectedVersion: plan.version,
  });
  await persistImportPage(db.pool, admin.id, plan.id, {
    fingerprint: randomUUID(),
    shipments: [shipment(801), shipment(802)],
    nextCursor: 2,
    ceiling: 2,
    hasMore: false,
    inspected: 2,
    excluded: 0,
  });
  const board = await orderBoard(db.pool, plan.id);
  for (const [index, order] of board.shipments.entries()) {
    await db.pool.query(
      "UPDATE route_shipments SET vehicle_id=$2 WHERE id=$1",
      [order.id, vehicles[index].id],
    );
  }
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
        RUTAS_DATABASE_URL: db.config.databaseUrl,
        RUTAS_INSTANCE_ID: db.config.instanceId,
        RUTAS_BOOTSTRAP_TOKEN: db.config.bootstrapToken,
        RUTAS_APP_ORIGIN: origin,
        RUTAS_TIMEZONE: "UTC",
        RUTAS_DRIVER_PIN_PEPPER: pepper,
        ODOO_URL: "",
        ODOO_DATABASE: "",
        ODOO_EMAIL: "",
        ODOO_USERNAME: "",
        ODOO_API_KEY: "",
        ODOO_PASSWORD: "",
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
  throw new Error("MOBILE_E2E_SERVER_NOT_READY");
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    await new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
      server.kill();
    });
  }
  await db?.close();
});

test("admin provisioning, native device login, route isolation and revocation over HTTP", async ({
  request,
}) => {
  test.setTimeout(120000);
  const accessUrl = `${origin}/api/drivers/${driverId}/mobile-access`;
  expect((await request.get(accessUrl)).status()).toBe(401);
  const adminSession = await request.post(`${origin}/api/session`, {
    headers: { Origin: origin },
    data: { login: adminLogin, password: adminPassword },
  });
  expect(adminSession.status()).toBe(200);
  expect(
    (
      await request.put(accessUrl, {
        headers: { Origin: "https://foreign.example" },
        data: { pin, expectedMobileVersion: 0 },
      })
    ).status(),
  ).toBe(403);
  const configured = await request.put(accessUrl, {
    headers: { Origin: origin },
    data: { pin, expectedMobileVersion: 0 },
  });
  expect(configured.status()).toBe(200);
  expect(await configured.json()).toMatchObject({
    enabled: true,
    version: 1,
    devices: 0,
  });
  const activation = await request.post(
    `${origin}/api/drivers/${driverId}/mobile-activation`,
    { headers: { Origin: origin }, data: { expectedMobileVersion: 1 } },
  );
  expect(activation.status()).toBe(200);
  const { code } = await activation.json();
  expect(code).toMatch(/^[0-9a-f]{64}$/);
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicKeyPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const badEnrollment = await request.post(`${origin}/api/mobile/enroll`, {
    data: { phone, pin, code: "0".repeat(64), publicKey: publicKeyPem },
  });
  expect(badEnrollment.status()).toBe(401);
  const enrollment = await request.post(`${origin}/api/mobile/enroll`, {
    data: { phone, pin, code, publicKey: publicKeyPem },
  });
  expect(enrollment.status()).toBe(201);
  const { deviceId, token } = await enrollment.json();
  expect(
    (
      await request.post(`${origin}/api/mobile/enroll`, {
        data: { phone, pin, code, publicKey: publicKeyPem },
      })
    ).status(),
  ).toBe(401);
  expect((await request.get(`${origin}/api/mobile/plans`)).status()).toBe(401);
  const authorization = { Authorization: `Bearer ${token}` };
  const plans = await request.get(`${origin}/api/mobile/plans`, {
    headers: authorization,
  });
  expect(plans.status()).toBe(200);
  expect(await plans.json()).toHaveLength(1);
  const route = await request.get(`${origin}/api/mobile/plans/${planId}`, {
    headers: authorization,
  });
  expect(route.status()).toBe(200);
  expect(await route.json()).toMatchObject({
    orders: [{ orderName: "S801" }],
    routeStatus: "not_calculated",
    route: null,
  });
  const challenge = await request.post(`${origin}/api/mobile/challenge`, {
    data: { phone, deviceId },
  });
  expect(challenge.status()).toBe(200);
  const { challengeId, nonce } = await challenge.json();
  const signature = sign(
    "sha256",
    Buffer.from(mobileChallengeMessage(challengeId, nonce)),
    privateKey,
  ).toString("base64");
  const credentials = { phone, pin, deviceId, challengeId, nonce, signature };
  const login = await request.post(`${origin}/api/mobile/session`, {
    data: credentials,
  });
  expect(login.status()).toBe(200);
  expect(
    (
      await request.post(`${origin}/api/mobile/session`, { data: credentials })
    ).status(),
  ).toBe(401);
  const loginToken = (await login.json()).token as string;
  const revoked = await request.delete(accessUrl, {
    headers: { Origin: origin },
    data: { expectedMobileVersion: 1 },
  });
  expect(revoked.status()).toBe(200);
  expect(
    (
      await request.get(`${origin}/api/mobile/plans`, {
        headers: { Authorization: `Bearer ${loginToken}` },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.get(`${origin}/api/mobile/plans`, {
        headers: authorization,
      })
    ).status(),
  ).toBe(401);
  expect((await request.get(accessUrl)).status()).toBe(200);
  expect(await (await request.get(accessUrl)).json()).toMatchObject({
    enabled: false,
    devices: 0,
  });
});

test("driver edit modal configures PIN without placing the code over other controls", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto(`${origin}/login`);
  await page.getByLabel("Usuario", { exact: true }).fill(adminLogin);
  await page.getByLabel("Contraseña", { exact: true }).fill(adminPassword);
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  await page.getByRole("button", { name: "Choferes", exact: true }).click();
  const card = page.getByRole("article", { name: "Chofer HTTP A" });
  await card.getByRole("button", { name: "Editar" }).click();
  const modal = page.getByRole("dialog", { name: "Editar chofer" });
  await expect(modal.getByText("Sin acceso móvil habilitado")).toBeVisible();
  const pinField = modal.getByLabel("PIN de 4 dígitos");
  await pinField.fill("1234");
  await modal.getByRole("button", { name: "Guardar PIN" }).click();
  await expect(
    modal.getByText("Habilitado · 0 celular(es) autorizado(s)"),
  ).toBeVisible();
  await expect(pinField).toHaveValue("");
  await page.setViewportSize({ width: 390, height: 844 });
  await mkdir("reports/screenshots", { recursive: true });
  await page.screenshot({
    path: "reports/screenshots/driver-mobile-access-390.png",
    fullPage: true,
  });
  expect(
    await modal.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await modal.getByRole("button", { name: "Generar activación" }).click();
  await expect(
    modal.getByText("Código de activación: se muestra sólo ahora."),
  ).toBeVisible();
  await modal.getByRole("button", { name: "Revocar acceso" }).click();
  await expect(modal.getByText("Sin acceso móvil habilitado")).toBeVisible();
  await expect(
    modal.getByText("Código de activación: se muestra sólo ahora."),
  ).toHaveCount(0);
});
