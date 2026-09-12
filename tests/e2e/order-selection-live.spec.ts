import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { startPostgres, freePort } from "../helpers/postgres";
import { bootstrap } from "../../src/core/auth";
import { createPlan } from "../../src/core/plans";
import { createVehicle } from "../../src/core/fleet";
import { orderBoard } from "../../src/core/orders";
import type { CandidateBatch } from "../../src/core/order-candidates-contract";

test("live Odoo selection, exact persistence, retry, select-all, concurrency and mobile", async ({
  browser,
}) => {
  test.skip(
    !process.env.ODOO_URL || !process.env.RUTAS_QA_ORDER_DATE,
    "Requires explicit real read-only Odoo environment and date",
  );
  test.setTimeout(240000);
  const db = await startPostgres();
  let child: ChildProcess | undefined;
  const date = process.env.RUTAS_QA_ORDER_DATE!,
    login = randomUUID(),
    password = randomUUID();
  const actor = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "QA selección real",
      login,
      password,
    })
  ).id;
  const plan = await createPlan(db.pool, actor, {
    date,
    label: "QA selección real",
  });
  await createVehicle(db.pool, actor, {
    id: randomUUID(),
    name: "Camioneta QA",
    brand: "QA",
    model: "QA",
    plate: randomUUID().slice(0, 8),
    mileage: 0,
    fuel: "Gasolina",
    available: true,
  });
  const port = await freePort(),
    origin = `http://127.0.0.1:${port}`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
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
          RUTAS_OPENAI_API_KEY: "",
        },
      },
    );
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin + "/api/ready")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(
      (
        await context.request.post(origin + "/api/session", {
          headers: { Origin: origin },
          data: { login, password },
        })
      ).status(),
    ).toBe(200);
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByLabel("Abrir borrador").selectOption(plan.id);
    await page
      .getByRole("button", { name: "Cargar pedidos de Odoo", exact: true })
      .click();
    const modal = page.getByRole("dialog", { name: "Cargar pedidos de Odoo" });
    await modal.getByRole("checkbox").first().check();
    await modal.getByLabel("Fecha de pedidos", { exact: true }).fill(date);
    const before = await orderBoard(db.pool, plan.id);
    let response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/orders/candidates") &&
        r.request().method() === "POST",
    );
    await modal
      .getByRole("button", { name: "Consultar pedidos", exact: true })
      .click();
    const queried = await response;
    expect(queried.status()).toBe(200);
    const batch = (await queried.json()) as CandidateBatch;
    expect(batch.validated).toBeGreaterThanOrEqual(2);
    expect(batch.pending).toBeGreaterThanOrEqual(1);
    expect(await orderBoard(db.pool, plan.id)).toEqual(before);
    const pending = batch.candidates.find(
      (c) => c.shipment.fulfillmentStatus === "pending_validation",
    )!;
    const done = batch.candidates.find(
      (c) => c.shipment.fulfillmentStatus === "validated",
    )!;
    for (const c of [pending, done])
      await modal
        .getByRole("checkbox", {
          name: `Seleccionar ${c.shipment.orderName} ${c.shipment.pickingName}`,
          exact: true,
        })
        .check();
    await mkdir("reports/screenshots", { recursive: true });
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        modal.getByRole("button", { name: "Guardar pedidos (2)", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `reports/screenshots/order-selection-${width}.png`,
      });
    }
    const confirmed = page.waitForResponse((r) =>
      r.url().endsWith("/orders/confirm"),
    );
    await modal
      .getByRole("button", { name: "Guardar pedidos (2)", exact: true })
      .click();
    const saved = await confirmed;
    expect(saved.status()).toBe(200);
    const receipt = await saved.json();
    const request = saved.request().postDataJSON();
    expect(receipt).toMatchObject({
      selected: 2,
      inserted: 2,
      pending: 1,
      validated: 1,
    });
    expect(
      (await orderBoard(db.pool, plan.id)).shipments
        .map((s) => s.orderId)
        .sort(),
    ).toEqual([pending.shipment.orderId, done.shipment.orderId].sort());
    const retry = await context.request.post(
      origin + `/api/plans/${plan.id}/orders/confirm`,
      { headers: { Origin: origin }, data: request },
    );
    expect(await retry.json()).toEqual(receipt);
    await expect(modal).toHaveCount(0);
    await page
      .getByRole("button", { name: "Cargar pedidos de Odoo", exact: true })
      .click();
    await modal.getByLabel("Fecha de pedidos", { exact: true }).fill(date);
    response = page.waitForResponse((r) =>
      r.url().endsWith("/orders/candidates"),
    );
    await modal
      .getByRole("button", { name: "Consultar pedidos", exact: true })
      .click();
    const again = (await (await response).json()) as CandidateBatch;
    expect(again.existing).toBe(2);
    const all = modal.getByRole("checkbox", {
      name: `Seleccionar todos los ${again.total} pedidos`,
    });
    await all.check();
    const excluded = again.candidates[0];
    await modal
      .getByRole("checkbox", {
        name: `Seleccionar ${excluded.shipment.orderName} ${excluded.shipment.pickingName}`,
        exact: true,
      })
      .uncheck();
    await expect(all).toHaveAttribute("aria-checked", "mixed");
    await db.pool.query(
      "UPDATE route_plans SET version=version+1 WHERE id=$1",
      [plan.id],
    );
    const conflict = page.waitForResponse((r) =>
      r.url().endsWith("/orders/confirm"),
    );
    await modal
      .getByRole("button", {
        name: `Guardar pedidos (${again.total - 1})`,
        exact: true,
      })
      .click();
    expect((await conflict).status()).toBe(409);
    await expect(modal.getByRole("alert")).toBeVisible();
    await expect(all).toHaveAttribute("aria-checked", "mixed");
    expect((await orderBoard(db.pool, plan.id)).shipments).toHaveLength(2);
    await modal.getByRole("button", { name: "Cancelar", exact: true }).click();
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
