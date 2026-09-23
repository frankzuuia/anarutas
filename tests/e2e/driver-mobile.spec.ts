import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  createHash,
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
  getVehicle,
} from "../../src/core/fleet";
import { createPlan } from "../../src/core/plans";
import {
  orderBoard,
  persistImportPage,
  selectPlanVehicles,
} from "../../src/core/orders";
import { mobileChallengeMessage } from "../../src/core/driver-mobile-auth";
import type { SourceShipment } from "../../src/core/orders-contract";
import { todayInTimezone } from "../../src/core/local-date";
import { routeFingerprint } from "../../src/core/route-fingerprint";

let db: Awaited<ReturnType<typeof startPostgres>>;
let server: ChildProcess;
let origin: string;
let driverId: string;
let planId: string;
let vehicleId: string;
let adminId: string;
let photoRoot: string;
const phone = "3312345678";
const pin = "4821";
const adminLogin = `mobile-http-${randomUUID()}`;
const adminPassword = randomUUID();
const pepper = randomBytes(48).toString("hex");
const serviceDate = todayInTimezone("UTC");

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
  photoRoot = await mkdtemp(join(tmpdir(), "ana-rutas-mobile-http-"));
  db = await startPostgres();
  const admin = await bootstrap(db.pool, db.config, {
    token: db.config.bootstrapToken,
    name: "Administrador móvil QA",
    login: adminLogin,
    password: adminPassword,
  });
  adminId = admin.id;
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
  vehicleId = vehicles[0].id;
  const plan = await createPlan(db.pool, admin.id, {
    date: serviceDate,
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
        RUTAS_UNIT_PHOTO_DIR: photoRoot,
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
  if (photoRoot) await rm(photoRoot, { recursive: true, force: true });
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
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicKeyPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const badEnrollment = await request.post(`${origin}/api/mobile/enroll`, {
    data: { phone, pin: "0000", publicKey: publicKeyPem },
  });
  expect(badEnrollment.status()).toBe(401);
  const enrollment = await request.post(`${origin}/api/mobile/enroll`, {
    data: { phone: `+52 ${phone}`, pin, publicKey: publicKeyPem },
  });
  expect(enrollment.status()).toBe(201);
  const { deviceId, token } = await enrollment.json();
  const repeatedEnrollment = await request.post(`${origin}/api/mobile/enroll`, {
    data: { phone, pin, publicKey: publicKeyPem },
  });
  expect(repeatedEnrollment.status()).toBe(201);
  expect((await repeatedEnrollment.json()).deviceId).toBe(deviceId);
  expect((await request.get(`${origin}/api/mobile/plans`)).status()).toBe(401);
  const authorization = { Authorization: `Bearer ${token}` };
  const plans = await request.get(`${origin}/api/mobile/plans`, {
    headers: authorization,
  });
  expect(plans.status()).toBe(200);
  expect(await plans.json()).toEqual([]);
  const hiddenDashboard = await request.get(`${origin}/api/mobile/dashboard`, { headers: authorization });
  expect(await hiddenDashboard.json()).toMatchObject({ plans: [], today: null });
  expect((await request.get(`${origin}/api/mobile/plans/${planId}`, { headers: authorization })).status()).toBe(404);

  const board = await orderBoard(db.pool, planId);
  const firstOrder = board.shipments.find((order) => order.vehicle_id === vehicleId)!;
  const metrics = {
    travelDistanceMeters: 1000,
    travelDurationSeconds: 600,
    waitDurationSeconds: 0,
    totalDurationSeconds: 600,
    performedShipmentCount: 1,
  };
  await db.pool.query(
    `INSERT INTO route_optimization_runs
       (id,plan_id,base_plan_version,applied_plan_version,request_hash,input_fingerprint,metrics,routes,skipped,created_by)
     VALUES($1,$2,$3,$3,$4,$5,$6,$7,'[]',$8)`,
    [randomUUID(), planId, board.plan.version,
      createHash("sha256").update(`mobile-e2e-${planId}`).digest("hex"),
      routeFingerprint(board, 0), JSON.stringify(metrics), JSON.stringify([{
        vehicleId,
        vehicleName: "HTTP camioneta 1",
        encodedPolyline: null,
        segmentPolylines: [],
        departureAt: `${serviceDate}T13:00:00.000Z`,
        finishedAt: `${serviceDate}T13:10:00.000Z`,
        trafficMode: "static",
        metrics,
        stops: [{
          shipmentId: firstOrder.id,
          position: 1,
          eta: `${serviceDate}T13:10:00.000Z`,
          travelDistanceMeters: 1000,
          travelDurationSeconds: 600,
          waitDurationSeconds: 0,
        }],
      }]), adminId],
  );
  const published = await request.post(`${origin}/api/plans/${planId}/publications`, {
    headers: { Origin: origin },
    data: { scope: "vehicle", vehicleId, expectedVersion: board.plan.version },
  });
  expect(published.status()).toBe(200);
  expect((await request.get(`${origin}/api/mobile/plans`, { headers: authorization }).then((response) => response.json()))).toHaveLength(1);
  const dashboard = await request.get(`${origin}/api/mobile/dashboard`, {
    headers: authorization,
  });
  expect(dashboard.status()).toBe(200);
  expect(await dashboard.json()).toMatchObject({
    driver: { id: driverId, name: "Chofer HTTP A", phone },
    timezone: "UTC",
    serviceDate,
    plans: [{ id: planId, vehicle_name: "HTTP camioneta 1", orders: 1 }],
    today: {
      plan: { id: planId, label: "Contrato HTTP móvil" },
      orders: [{ orderName: "S801" }],
      routeStatus: "current",
      publication: { revision: 1, startedAt: null },
    },
  });
  const route = await request.get(`${origin}/api/mobile/plans/${planId}`, {
    headers: authorization,
  });
  expect(route.status()).toBe(200);
  expect(await route.json()).toMatchObject({
    orders: [{ orderName: "S801" }],
    routeStatus: "current",
    publication: { revision: 1, startedAt: null },
  });
  const startUrl = `${origin}/api/mobile/plans/${planId}/start`;
  const startRequest = { headers: authorization, data: { expectedRevision: 1 } };
  const missingConfirmation = await request.post(startUrl, { headers: authorization });
  expect(missingConfirmation.status()).toBe(415);
  const staleConfirmation = await request.post(startUrl, { headers: authorization, data: { expectedRevision: 0 } });
  expect(staleConfirmation.status()).toBe(400);
  const blockedStart = await request.post(startUrl, startRequest);
  expect(blockedStart.status()).toBe(409);
  expect(await blockedStart.json()).toMatchObject({ error: "UNIT_PHOTOS_REQUIRED" });
  const photoIds: string[] = [];
  for (let index = 0; index < 5; index++) {
    const image = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: index * 30, g: 80, b: 120 } },
    }).jpeg().toBuffer();
    const uploaded = await request.post(`${origin}/api/mobile/plans/${planId}/unit-photos`, {
      headers: { ...authorization, "Content-Type": "image/jpeg" },
      data: image,
    });
    expect(uploaded.status()).toBe(201);
    photoIds.push((await uploaded.json()).id);
  }
  const visiblePhotos = await request.get(`${origin}/api/vehicles/${vehicleId}/unit-photos?date=${serviceDate}`);
  expect(visiblePhotos.status()).toBe(200);
  expect(await visiblePhotos.json()).toHaveLength(5);
  expect((await request.get(`${origin}/api/unit-photos/${photoIds[0]}`)).headers()["content-type"])
    .toContain("image/webp");
  expect((await request.get(`${origin}/api/mobile/unit-photos/${photoIds[0]}`)).status()).toBe(401);
  const firstPhotoTimestamp = (await db.pool.query(
    "SELECT created_at FROM route_unit_photos WHERE id=$1", [photoIds[0]],
  )).rows[0].created_at;
  await db.pool.query(
    "UPDATE route_unit_photos SET created_at=created_at-interval '1 day' WHERE id=$1",
    [photoIds[0]],
  );
  const stalePhotoRoute = await request.get(`${origin}/api/mobile/plans/${planId}`, { headers: authorization });
  expect((await stalePhotoRoute.json()).publication.photoCount).toBe(4);
  expect((await request.post(startUrl, startRequest)).status()).toBe(409);
  await db.pool.query("UPDATE route_unit_photos SET created_at=$2 WHERE id=$1",
    [photoIds[0], firstPhotoTimestamp]);
  const wrongRevision = await request.post(startUrl, { headers: authorization, data: { expectedRevision: 2 } });
  expect(wrongRevision.status()).toBe(409);
  expect(await wrongRevision.json()).toMatchObject({ error: "VERSION_CONFLICT" });
  const firstStart = await request.post(startUrl, startRequest);
  expect(firstStart.status()).toBe(200);
  expect(await firstStart.json()).toMatchObject({ alreadyStarted: false });
  const repeatedStart = await request.post(startUrl, startRequest);
  expect(repeatedStart.status()).toBe(200);
  expect(await repeatedStart.json()).toMatchObject({ alreadyStarted: true });
  expect((await request.get(`${origin}/api/mobile/plans/${planId}`, { headers: authorization }).then((response) => response.json())).publication.startedAt)
    .toBeTruthy();
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

test("driver edit modal enables direct phone and PIN access", async ({
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
  await expect(
    modal.getByText(
      "El chofer puede entrar directamente en la APK con su teléfono y PIN.",
    ),
  ).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Generar activación" }),
  ).toHaveCount(0);
  await modal.getByRole("button", { name: "Revocar acceso" }).click();
  await expect(modal.getByText("Sin acceso móvil habilitado")).toBeVisible();
  await modal.getByRole("button", { name: "Cerrar formulario" }).click();
  await page.getByRole("button", { name: "Control de unidades" }).click();
  await page.getByRole("button", { name: /HTTP camioneta 1/ }).click();
  await expect(page.getByRole("heading", { name: "HTTP camioneta 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contrato HTTP móvil" })).toBeVisible();
  await expect(page.getByAltText("Fotografía de la unidad")).toHaveCount(5);
  await expect.poll(async () => page.getByAltText("Fotografía de la unidad").evaluateAll(
    (images) => images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0),
  )).toBe(true);
  await page.screenshot({ path: "reports/screenshots/unit-control-390.png", fullPage: true });
  const relief = await createDriver(db.pool, adminId, {
    id: randomUUID(), name: "Relevo HTTP", phone: "3312345699",
    emergency_name: "", emergency_phone: "", blood_type: "", active: true,
  });
  let vehicle = await getVehicle(db.pool, vehicleId);
  await assignDriver(db.pool, adminId, vehicleId, {
    driver_id: null, expectedVersion: vehicle.version,
  });
  vehicle = await getVehicle(db.pool, vehicleId);
  await assignDriver(db.pool, adminId, vehicleId, {
    driver_id: relief.id, expectedVersion: vehicle.version,
  });
  await page.getByRole("button", { name: "Planificar rutas" }).click();
  await page.getByLabel("Abrir borrador").selectOption(planId);
  await expect(page.getByText("Ruta de Chofer HTTP A · Flota: Relevo HTTP")).toBeVisible();
  await expect(page.getByText("Ruta iniciada", { exact: true })).toBeVisible();
});
