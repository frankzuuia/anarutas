import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { paymentExecutionFixture } from "../helpers/payment-execution";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";
import { readMobileFinanceDetail } from "../../src/core/finance-read";
import { confirmOrderPayment } from "../../src/core/payments";
import {
  requestSettlement,
  decideSettlement,
} from "../../src/core/settlements";
import { completeDriverWork } from "../../src/core/route-work";

test("a rejected route packet cannot hide a later complete individual reception and its tickets", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const f = await paymentExecutionFixture();
  let server: ChildProcess | undefined;
  try {
    const password = randomUUID();
    const receiver = await createUser(f.db.pool, f.actor, {
      name: "Recepción individual QA",
      login: "individual-qa",
      password,
      role: "settlement",
    });
    const auth = f.members[0].authorization;
    const read = () => readMobileFinanceDetail(f.db.pool, auth, f.executionId);
    const initial = await read();
    for (const order of initial.orders)
      await confirmOrderPayment(
        f.db.pool,
        auth,
        f.executionId,
        {
          commandId: randomUUID(),
          shipmentId: order.shipmentId,
          basis: order.basis,
          captureVersion: 2,
          method: "cash",
          tendered: "20",
          change: "0",
          note: "",
        },
        f.timezone,
      );
    await f.finish();
    const decide = async (id: string, decision: "accepted" | "rejected") => {
      const pending = (await read()).requests.find((r) => r.id === id)!;
      await decideSettlement(f.db.pool, receiver.id, id, {
        commandId: randomUUID(),
        version: pending.version,
        basis: pending.basis,
        decision,
        note: "Revisión en bodega",
      });
    };
    const rejected = await requestSettlement(f.db.pool, auth, f.executionId, {
      commandId: randomUUID(),
      shipmentId: null,
      basis: (await read()).routeSettlement.basis,
    });
    await decide(rejected.id, "rejected");
    for (const order of initial.orders) {
      const individual = await requestSettlement(
        f.db.pool,
        auth,
        f.executionId,
        {
          commandId: randomUUID(),
          shipmentId: order.shipmentId,
        },
      );
      await decide(individual.id, "accepted");
    }
    const received = await read();
    expect(received.work.eligible).toBe(true);
    await completeDriverWork(f.db.pool, auth, f.executionId, {
      commandId: randomUUID(),
      basis: received.work.basis,
    });
    const port = await freePort(),
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
          data: { login: "individual-qa", password },
        })
      ).status(),
    ).toBe(200);
    await page.goto(origin);
    await page.getByLabel("Desde", { exact: true }).fill("2026-09-24");
    await page.getByLabel("Hasta", { exact: true }).fill("2026-09-24");
    await page
      .getByRole("button", { name: /Ejecución QA.*2026-09-24/ })
      .click();
    const card = page.locator(".settlement-route-card");
    await expect(card.locator(".badge")).toHaveText("Recibida");
    await expect(card).toContainText("3 pedidos");
    await expect(
      card.getByRole("button", { name: "Recibida", exact: true }),
    ).toBeDisabled();
    await card.locator(".settlement-route-open").click();
    const packet = page.getByRole("dialog", { name: /Liquidación de ruta/ });
    await expect(packet.locator(".settlement-packet-order")).toHaveCount(3);
    await expect(packet).toContainText("$60.00 MXN");
    await packet.locator(".settlement-packet-order").first().click();
    const receipt = page.getByRole("dialog").locator(".settlement-collected");
    await expect(receipt).toContainText("Total cobrado");
    await expect(receipt.locator("b")).toHaveText("$20.00 MXN");
    await page.keyboard.press("Escape");
    await expect(packet).toBeVisible();
    await expect(
      packet.getByRole("button", { name: "Recibida", exact: true }),
    ).toBeDisabled();
  } finally {
    if (server && server.exitCode === null)
      await new Promise<void>((resolve) => {
        server!.once("exit", () => resolve());
        server!.kill();
      });
    await f.close();
  }
});
