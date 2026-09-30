import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { paymentExecutionFixture } from "../helpers/payment-execution";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";

test("real HTTP collection to settlement, UI roles, individual acceptance and remaining route", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const f = await paymentExecutionFixture();
  const timings: number[] = [];
  page.on("response", (response) => {
    const timing = response.headers()["server-timing"];
    if (response.url().includes("/api/settlements") && response.ok() && timing)
      timings.push(Number(timing.split("dur=")[1]));
  });
  let server: ChildProcess | undefined;
  try {
    await f.finish();
    const password = randomUUID();
    await createUser(f.db.pool, f.actor, {
      name: "Recepción QA",
      login: "settlement-http",
      password,
      role: "settlement",
    });
    const adminPassword = randomUUID();
    await createUser(f.db.pool, f.actor, {
      name: "Rutas QA",
      login: "routes-http",
      password: adminPassword,
      role: "routes",
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
    const path = `${origin}/api/mobile/finance/${f.executionId}`,
      headers = { Authorization: f.members[0].authorization };
    expect((await request.get(path)).status()).toBe(401);
    expect(
      (
        await request.get(path, {
          headers: { Authorization: f.members[1].authorization },
        })
      ).status(),
    ).toBe(404);
    for (const [index, method] of [
      [0, "cash"],
      [1, "transfer"],
      [2, "credit"],
    ] as const) {
      const data = await (await request.get(path, { headers })).json(),
        order = data.orders.find(
          (o: { shipmentId: string }) =>
            o.shipmentId === f.shipmentRows[index].id,
        );
      const payload = {
        commandId: randomUUID(),
        shipmentId: order.shipmentId,
        basis: order.basis,
        method,
        tendered: method === "cash" ? "15" : method === "credit" ? "0" : "20",
        change: "0",
        note: index === 0 ? "Quedan 5" : "",
      };
      const response = await request.post(`${path}/payments`, {
        headers,
        data: payload,
      });
      expect(response.status(), await response.text()).toBe(200);
      expect(
        await (
          await request.post(`${path}/payments`, { headers, data: payload })
        ).json(),
      ).toMatchObject({ duplicate: true });
    }
    const individual = await (
      await request.post(`${path}/requests`, {
        headers,
        data: { commandId: randomUUID(), shipmentId: f.shipmentRows[0].id },
      })
    ).json();
    expect(individual.id).toBeTruthy();
    const login = await page.request.post(`${origin}/api/session`, {
      headers: { Origin: origin },
      data: { login: "settlement-http", password },
    });
    expect(login.status()).toBe(200);
    for (const route of [
      "/api/plans",
      "/api/users",
      "/api/drivers",
      "/api/vehicles",
      "/api/customers",
      "/api/audit",
      "/api/incidents",
      "/api/incidents/live",
      "/api/incidents/products",
      "/api/control-center",
      "/api/live-routes",
      "/api/maps/config",
      "/api/google-consumption",
    ])
      expect((await page.request.get(origin + route)).status(), route).toBe(
        403,
      );
    expect(
      (
        await page.request.post(`${origin}/api/users`, {
          headers: { Origin: origin },
          data: {
            name: "Forbidden",
            login: "forbidden",
            password: randomUUID(),
            role: "routes",
          },
        })
      ).status(),
    ).toBe(403);
    await page.goto(origin);
    await expect(
      page.getByRole("button", { name: "Planificar rutas", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Liquidación de rutas", exact: true }),
    ).toBeEnabled();
    await page.getByLabel("Desde", { exact: true }).fill("2026-09-24");
    await page.getByLabel("Hasta", { exact: true }).fill("2026-09-24");
    await page
      .getByRole("button", { name: /Ejecución QA.*2026-09-24/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Solicitudes del chofer" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Aceptar", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("15");
    await expect(dialog).toContainText("S1");
    await mkdir(".local/qa-settlements", { recursive: true });
    await page.screenshot({ path: ".local/qa-settlements/confirmation.png" });
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    expect(
      (await (await request.get(path, { headers })).json()).requests[0].status,
    ).toBe("pending");
    await page.getByRole("button", { name: "Aceptar", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Confirmar recepción", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(
        async () =>
          (await (await request.get(path, { headers })).json()).requests.find(
            (r: { id: string }) => r.id === individual.id,
          ).status,
      )
      .toBe("accepted");
    const rest = await request.post(`${path}/requests`, {
      headers,
      data: { commandId: randomUUID(), shipmentId: null },
    });
    expect(rest.status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Aceptar", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "Aceptar", exact: true }).click();
    await expect(dialog).toContainText("20");
    await dialog
      .getByRole("button", { name: "Confirmar recepción", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    const after = await (await request.get(path, { headers })).json();
    expect(after.outstandingTotals).toEqual([]);
    expect(after.acceptedTotals[0]).toMatchObject({
      cash: "15",
      transfer: "20",
      credit: "20",
      balance: "5",
    });
    await mkdir(".local/qa-settlements", { recursive: true });
    await page.screenshot({
      path: ".local/qa-settlements/receiver.png",
      fullPage: true,
    });
    await page
      .getByRole("combobox", { name: "Consultar por", exact: true })
      .selectOption("receipt");
    const { todayInTimezone } = await import("../../src/core/local-date");
    const receiptDate = todayInTimezone(f.timezone);
    await page.getByLabel("Hasta", { exact: true }).fill(receiptDate);
    await page.getByLabel("Desde", { exact: true }).fill(receiptDate);
    await expect(
      page.getByRole("button", { name: /Ejecución QA.*2026-09-24/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Cobrado por choferes", exact: true }),
    ).toHaveCount(0);
    const receiptReport = await (
      await page.request.get(
        `${origin}/api/settlements?dateBasis=receipt&from=${receiptDate}&to=${receiptDate}`,
      )
    ).json();
    expect(receiptReport.metrics).toMatchObject([
      { stage: "accepted", cash: "15", transfer: "20", credit: "20" },
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".local/qa-settlements/receipt-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.request.delete(`${origin}/api/session`, {
      headers: { Origin: origin },
      data: {},
    });
    await page.request.post(`${origin}/api/session`, {
      headers: { Origin: origin },
      data: { login: "routes-http", password: adminPassword },
    });
    expect((await page.request.get(`${origin}/api/settlements`)).status()).toBe(
      403,
    );
    await page.goto(origin);
    await expect(
      page.getByRole("button", { name: "Liquidación de rutas", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Usuarios y accesos", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Añadir liquidador", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Añadir administrador", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: ".local/qa-settlements/accounts.png",
      fullPage: true,
    });
    timings.sort((a, b) => a - b);
    await writeFile(
      ".local/qa-settlements/timing.json",
      JSON.stringify(
        {
          sampleCount: timings.length,
          p95Ms: timings[Math.ceil(timings.length * 0.95) - 1],
          maximumMs: timings.at(-1),
          measurements: timings,
          environment:
            "isolated local PostgreSQL and Next production build; not a load test",
        },
        null,
        2,
      ),
    );
  } finally {
    if (server && server.exitCode === null)
      await new Promise<void>((resolve) => {
        server!.once("exit", () => resolve());
        server!.kill();
      });
    await f.close();
  }
});
