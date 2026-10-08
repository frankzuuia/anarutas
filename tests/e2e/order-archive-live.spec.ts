import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { startPostgres, freePort } from "../helpers/postgres";
import { bootstrap } from "../../src/core/auth";
import { createPlan } from "../../src/core/plans";
import { createVehicle } from "../../src/core/fleet";
import { orderBoard } from "../../src/core/orders";
import type { CandidateBatch } from "../../src/core/order-candidates-contract";

test("real Odoo read-only and HTTP: query, exact save, replay, origin and authentication", async ({
  browser,
}) => {
  test.skip(
    !process.env.ODOO_URL ||
      !process.env.RUTAS_QA_ORDER_DATE ||
      !process.env.RUTAS_QA_ALLOWED_ODOO_HOST,
    "Requires an explicitly authorized development Odoo and date",
  );
  expect(new URL(process.env.ODOO_URL!).hostname).toBe(
    process.env.RUTAS_QA_ALLOWED_ODOO_HOST,
  );
  test.setTimeout(150000);
  const db = await startPostgres();
  const login = randomUUID(),
    password = randomUUID(),
    date = process.env.RUTAS_QA_ORDER_DATE!;
  let child: ChildProcess | undefined;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    const actor = (
      await bootstrap(db.pool, db.config, {
        token: db.config.bootstrapToken,
        name: "QA sólo lectura",
        login,
        password,
      })
    ).id;
    const plan = await createPlan(db.pool, actor, {
      date,
      label: "QA aviso archivados",
    });
    const vehicle = await createVehicle(db.pool, actor, {
      id: randomUUID(),
      name: "QA",
      brand: "QA",
      model: "QA",
      plate: randomUUID().slice(0, 8),
      mileage: 0,
      fuel: "Gasolina",
      available: true,
    });
    const port = await freePort(),
      origin = `http://127.0.0.1:${port}`;
    child = spawn(
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
          RUTAS_APP_ORIGIN: origin,
          RUTAS_DATABASE_URL: db.config.databaseUrl,
          RUTAS_INSTANCE_ID: db.config.instanceId,
          RUTAS_TIMEZONE: "America/Mexico_City",
          RUTAS_GOOGLE_FINOPS_SERVICE_ACCOUNT_JSON_BASE64: "",
          RUTAS_GOOGLE_ROUTES_API_KEY: "",
        },
      },
    );
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin + "/api/ready")).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const endpoint = origin + `/api/plans/${plan.id}/orders/candidates`;
    const query = {
      date,
      vehicleIds: [vehicle.id],
      expectedVersion: plan.version,
    };
    expect(
      (
        await context.request.post(endpoint, {
          headers: { Origin: origin },
          data: query,
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await context.request.post(origin + "/api/session", {
          headers: { Origin: origin },
          data: { login, password },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await context.request.post(endpoint, {
          headers: { Origin: "https://other.example" },
          data: query,
        })
      ).status(),
    ).toBe(403);
    const before = await orderBoard(db.pool, plan.id);
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByLabel("Abrir borrador").selectOption(plan.id);
    await page
      .getByRole("button", { name: "Cargar pedidos de Odoo", exact: true })
      .click();
    const modal = page.getByRole("dialog", { name: "Cargar pedidos de Odoo" });
    await modal.getByRole("checkbox").first().check();
    await modal.getByLabel("Fecha de pedidos", { exact: true }).fill(date);
    const response = page.waitForResponse((r) => r.url() === endpoint);
    await modal
      .getByRole("button", { name: "Consultar pedidos", exact: true })
      .click();
    const queried = await response;
    expect(queried.status()).toBe(200);
    const batch = (await queried.json()) as CandidateBatch;
    expect(batch.total).toBeGreaterThan(0);
    expect(Array.isArray(batch.archivedCustomerOrders)).toBe(true);
    expect(await orderBoard(db.pool, plan.id)).toEqual(before);
    for (const archived of batch.archivedCustomerOrders!) {
      expect(
        batch.candidates.some(
          (c) =>
            c.shipment.pickingId === archived.pickingId &&
            c.shipment.orderId === archived.orderId,
        ),
      ).toBe(false);
    }
    if (!batch.archivedCustomerOrders!.length)
      await expect(
        modal.getByRole("complementary", {
          name: "Pedidos de clientes archivados",
        }),
      ).toHaveCount(0);
    const candidate = batch.candidates[0];
    await modal
      .getByRole("checkbox", {
        name: `Seleccionar ${candidate.shipment.orderName} ${candidate.shipment.pickingName}`,
        exact: true,
      })
      .check();
    const savedResponse = page.waitForResponse((r) =>
      r.url().endsWith("/orders/confirm"),
    );
    await modal
      .getByRole("button", { name: "Guardar pedidos (1)", exact: true })
      .click();
    const saved = await savedResponse;
    expect(saved.status()).toBe(200);
    const receipt = await saved.json();
    expect(receipt).toMatchObject({ selected: 1, inserted: 1 });
    const retry = await context.request.post(saved.url(), {
      headers: { Origin: origin },
      data: saved.request().postDataJSON(),
    });
    expect(await retry.json()).toEqual(receipt);
    const board = await orderBoard(db.pool, plan.id);
    expect(board.shipments).toHaveLength(1);
    expect(board.shipments[0]).toMatchObject({
      partnerId: candidate.shipment.partnerId,
      orderId: candidate.shipment.orderId,
      address: candidate.shipment.address,
    });
  } finally {
    await context.close();
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) =>
        child!.once("exit", () => resolve()),
      );
      child.kill();
      await exited;
    }
    await db.close();
  }
});
