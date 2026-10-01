import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { paymentExecutionFixture } from "../helpers/payment-execution";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";
import {
  readMobileFinanceDetail,
  readSettlementDetail,
} from "../../src/core/finance-read";
import { confirmOrderPayment } from "../../src/core/payments";
import { requestSettlement } from "../../src/core/settlements";

test("live collections append without moving previous cards and fifty receipts keep compact accessible modals", async ({
  page,
  request,
}) => {
  test.setTimeout(600000);
  const f = await paymentExecutionFixture({ orderCount: 51 });
  let server: ChildProcess | undefined;
  try {
    const password = randomUUID();
    const receiver = await createUser(f.db.pool, f.actor, {
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
    // Collection chronology deliberately opposes the route's operational order.
    const receipts = [...detail.orders].reverse();
    const collect = async (order: (typeof detail.orders)[number]) => {
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
    };
    for (const order of receipts.slice(0, -1)) await collect(order);
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
    const folios = page.locator(".settlement-client > small");
    await expect(folios.first()).toHaveText(receipts[0].orderName);
    const previousFolios = await folios.allTextContents();
    const firstPosition = await page
      .locator(".settlement-order")
      .first()
      .boundingBox();
    const back = page.getByRole("button", { name: "Volver a choferes" });
    expect(
      await back
        .locator("svg")
        .evaluate((icon) => getComputedStyle(icon).color),
    ).toBe("rgb(255, 121, 121)");
    const oldCard = page.locator(".settlement-order").first();
    expect((await oldCard.boundingBox())!.height).toBeLessThan(310);
    expect(
      await oldCard
        .getByRole("button", { name: "Ver pedido y cobro" })
        .evaluate((button) => button.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
    const started = Date.now();
    await collect(receipts.at(-1)!);
    // No manual refresh: PostgreSQL event -> SSE -> visible panel update.
    await expect(
      page.getByRole("status").filter({ hasText: /^50 pedidos$/ }),
    ).toBeVisible({ timeout: 20000 });
    const reflectedMs = Date.now() - started;
    expect(await folios.allTextContents()).toEqual(previousFolios);
    const updatedPosition = await page
      .locator(".settlement-order")
      .first()
      .boundingBox();
    expect(updatedPosition!.x).toBe(firstPosition!.x);
    expect(updatedPosition!.y).toBe(firstPosition!.y);
    const collected = await readSettlementDetail(
      f.db.pool,
      receiver.id,
      f.executionId,
    );
    expect(collected.orders.map((order) => order.shipmentId)).toEqual(
      receipts.map((order) => order.shipmentId),
    );
    // The shared mobile operating contract must still follow route stops.
    expect(
      (
        await readMobileFinanceDetail(
          f.db.pool,
          f.members[0].authorization,
          f.executionId,
        )
      ).orders.map((order) => order.shipmentId),
    ).toEqual(detail.orders.map((order) => order.shipmentId));
    await page.reload();
    await page.getByLabel("Desde", { exact: true }).fill("2026-09-24");
    await page.getByLabel("Hasta", { exact: true }).fill("2026-09-24");
    await page
      .getByRole("button", { name: /Ejecución QA.*2026-09-24/ })
      .click();
    await expect(folios.first()).toHaveText(receipts[0].orderName);
    expect(await folios.allTextContents()).toEqual(previousFolios);
    await mkdir(".local/qa-settlements", { recursive: true });
    await page.screenshot({
      path: ".local/qa-settlements/compact-receipts-desktop.png",
      fullPage: true,
    });
    console.log(
      `Collection event reflected in ${reflectedMs}ms; first card height=${(await oldCard.boundingBox())!.height}px`,
    );
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
    await expect(page.locator(".settlement-client > small").last()).toHaveText(
      receipts.at(-1)!.orderName,
    );
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
    await f.finish();
    const routeReview = (
      await readMobileFinanceDetail(
        f.db.pool,
        f.members[0].authorization,
        f.executionId,
      )
    ).routeSettlement;
    expect(routeReview.paymentIds).toHaveLength(50);
    await requestSettlement(
      f.db.pool,
      f.members[0].authorization,
      f.executionId,
      {
        commandId: randomUUID(),
        shipmentId: null,
        basis: routeReview.basis,
      },
    );
    const routeCard = page.locator(".settlement-route-card");
    await expect(
      routeCard.getByRole("button", {
        name: "Aceptar liquidación de ruta",
        exact: true,
      }),
    ).toBeEnabled({ timeout: 20000 });
    await routeCard.locator(".settlement-route-open").click();
    const packet = page.getByRole("dialog", { name: /Liquidación de ruta/ });
    await expect(packet.locator(".settlement-packet-order")).toHaveCount(50);
    const body = packet.locator(".modal-body");
    expect(await body.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(
      true,
    );
    await packet.locator(".settlement-packet-order").last().click();
    await expect(dialog).toContainText("$20.00 MXN");
    await page.keyboard.press("Escape");
    await expect(packet.locator(".settlement-packet-order")).toHaveCount(50);
    await body.evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    const acceptRoute = packet.getByRole("button", {
      name: "Aceptar liquidación de ruta",
      exact: true,
    });
    const footerBounds = await acceptRoute.boundingBox();
    expect(footerBounds!.y + footerBounds!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".local/qa-settlements/route-packet-fifty-mobile.png",
    });
    await acceptRoute.click();
    const confirmation = page.getByRole("dialog", {
      name: "Confirmar recepción",
      exact: true,
    });
    const accept = confirmation.getByRole("button", {
      name: "Aceptar",
      exact: true,
    });
    expect(
      (await accept.boundingBox())!.y + (await accept.boundingBox())!.height,
    ).toBeLessThanOrEqual(page.viewportSize()!.height);
    await accept.click();
    await expect(
      packet.getByRole("button", { name: "Recibida", exact: true }),
    ).toBeDisabled();
    const received = await readSettlementDetail(
      f.db.pool,
      receiver.id,
      f.executionId,
    );
    expect(
      received.orders.filter((o) => o.settlementStatus === "accepted"),
    ).toHaveLength(50);
    expect(received.work).toMatchObject({
      eligible: true,
      summary: { deliveredOrders: 50, totals: [{ total: "1000" }] },
    });
  } finally {
    if (server && server.exitCode === null)
      await new Promise<void>((resolve) => {
        server!.once("exit", () => resolve());
        server!.kill();
      });
    await f.close();
  }
});
