import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { paymentExecutionFixture } from "../helpers/payment-execution";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";
import { readMobileFinanceDetail } from "../../src/core/finance-read";
import { confirmOrderPayment } from "../../src/core/payments";

test("fifty real collected orders stay paginated and open accessible independent modals", async ({
  page,
  request,
}) => {
  test.setTimeout(600000);
  const f = await paymentExecutionFixture({ orderCount: 51 });
  let server: ChildProcess | undefined;
  try {
    const password = randomUUID();
    await createUser(f.db.pool, f.actor, {
      name: "Recepción de volumen",
      login: "volume-receiver",
      password,
      role: "settlement",
    });
    const detail = await readMobileFinanceDetail(
      f.db.pool,
      f.members[0].authorization,
      f.executionId,
    );
    expect(detail.orders).toHaveLength(50);
    for (const order of detail.orders) {
      await confirmOrderPayment(
        f.db.pool,
        f.members[0].authorization,
        f.executionId,
        {
          commandId: randomUUID(),
          shipmentId: order.shipmentId,
          basis: order.basis,
          captureVersion: 2,
          method: "cash",
          tendered: order.financial!.totals!.net,
          change: "0",
          note: "Recibo de volumen QA",
        },
        f.timezone,
      );
    }
    const origin = `http://127.0.0.1:${await freePort()}`;
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
          RUTAS_APP_ORIGIN: origin,
          RUTAS_TIMEZONE: f.timezone,
          ODOO_URL: "",
          ODOO_DATABASE: "",
          ODOO_EMAIL: "",
          ODOO_API_KEY: "",
        },
      },
    );
    await expect
      .poll(
        async () => {
          try {
            return (await request.get(`${origin}/api/ready`)).status();
          } catch {
            return 0;
          }
        },
        { timeout: 45000 },
      )
      .toBe(200);
    expect(
      (
        await page.request.post(`${origin}/api/session`, {
          headers: { Origin: origin },
          data: { login: "volume-receiver", password },
        })
      ).status(),
    ).toBe(200);
    await page.goto(origin);
    await page.getByLabel("Desde", { exact: true }).fill("2026-09-24");
    await page.getByLabel("Hasta", { exact: true }).fill("2026-09-24");
    await page
      .getByRole("button", { name: /Ejecución QA.*2026-09-24/ })
      .click();
    await expect(page.locator(".settlement-order")).toHaveCount(12);
    await expect(
      page.getByText("Página 1 de 5", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Más pedidos", exact: true })
      .click();
    await expect(
      page.getByText("Página 2 de 5", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Buscar pedido o cliente").fill("S51");
    await expect(page.locator(".settlement-order")).toHaveCount(1);
    const order = page.locator(".settlement-order");
    const amount = order.locator(".settlement-order-amount");
    expect(
      await amount.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    ).toBe("rgba(0, 0, 0, 0)");
    expect((await amount.boundingBox())!.height).toBeLessThan(130);
    await page.setViewportSize({ width: 390, height: 844 });
    await order.getByRole("button", { name: "Ver pedido y cobro" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("S51");
    await expect(dialog).toContainText("$20.00 MXN");
    const productBounds = await dialog
      .locator(".settlement-products")
      .evaluate((section) => {
        const bounds = section.getBoundingClientRect();
        return [...section.querySelectorAll("tbody td")].every((cell) => {
          const cellBounds = cell.getBoundingClientRect();
          return (
            cellBounds.left >= bounds.left &&
            cellBounds.right <= bounds.right + 1
          );
        });
      });
    expect(productBounds).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await mkdir(".local/qa-settlements", { recursive: true });
    await page.screenshot({
      path: ".local/qa-settlements/volume-modal-mobile.png",
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      order.getByRole("button", { name: "Ver pedido y cobro" }),
    ).toBeFocused();
    await page.getByLabel("Buscar pedido o cliente").fill("");
    await page.getByLabel("Estado del pedido").selectOption("accepted");
    await expect(page.locator(".settlement-order")).toHaveCount(0);
    await page.getByLabel("Estado del pedido").selectOption("unsettled");
    await expect(page.locator(".settlement-order")).toHaveCount(12);
    for (let index = 0; index < 4; index++)
      await page
        .getByRole("button", { name: "Más pedidos", exact: true })
        .click();
    await expect(page.locator(".settlement-order")).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "Más pedidos", exact: true }),
    ).toBeDisabled();
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int AS n FROM route_settlement_requests",
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    if (server && server.exitCode === null)
      await new Promise<void>((resolve) => {
        server!.once("exit", () => resolve());
        server!.kill();
      });
    await f.close();
  }
});
