import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { paymentExecutionFixture } from "../helpers/payment-execution";
import { prepareSameDayPlan } from "../helpers/same-day-plan";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";
import { todayInTimezone } from "../../src/core/local-date";

test("creates independent same-day drafts in Chrome then starts a second route after full financial closure over HTTP", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const day = todayInTimezone("America/Mexico_City");
  const f = await paymentExecutionFixture({
    warehouseRequired: false,
    now: new Date(`${day}T17:00:00Z`),
  });
  let server: ChildProcess | undefined;
  const timings: Record<string, number[]> = { creation: [], start: [] };
  try {
    const routesPassword = randomUUID(),
      receiverPassword = randomUUID();
    await createUser(f.db.pool, f.actor, {
      name: "Rutas QA",
      login: "same-day-routes-http",
      password: routesPassword,
    });
    await createUser(f.db.pool, f.actor, {
      name: "Recepción QA",
      login: "same-day-receiver-http",
      password: receiverPassword,
      role: "settlement",
    });
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
          RUTAS_UNIT_PHOTO_DIR: f.photoRoot,
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
    const financeUrl = `${origin}/api/mobile/finance/${f.executionId}`;
    const headers = { Authorization: f.members[0].authorization };
    const finance = async () =>
      (await request.get(financeUrl, { headers })).json();
    for (const order of (await finance()).orders) {
      const response = await request.post(`${financeUrl}/payments`, {
        headers,
        data: {
          commandId: randomUUID(),
          shipmentId: order.shipmentId,
          basis: order.basis,
          captureVersion: 2,
          method: "cash",
          tendered: "20",
          change: "0",
          note: "",
        },
      });
      expect(response.status(), await response.text()).toBe(200);
    }
    expect(
      (
        await request.post(`${origin}/api/session`, {
          headers: { Origin: origin },
          data: {
            login: "same-day-receiver-http",
            password: receiverPassword,
          },
        })
      ).status(),
    ).toBe(200);
    const before = await finance();
    const submitted = await request.post(`${financeUrl}/requests`, {
      headers,
      data: {
        commandId: randomUUID(),
        shipmentId: null,
        basis: before.routeSettlement.basis,
      },
    });
    expect(submitted.status()).toBe(200);
    const packetId = (await submitted.json()).id;
    const packet = (await finance()).requests.find(
      (r: { id: string }) => r.id === packetId,
    );
    expect(
      (
        await request.post(`${origin}/api/settlements/requests/${packetId}`, {
          headers: { Origin: origin },
          data: {
            commandId: randomUUID(),
            version: packet.version,
            basis: packet.basis,
            decision: "accepted",
            note: "",
          },
        })
      ).status(),
    ).toBe(200);
    const closed = await request.post(`${financeUrl}/work`, {
      headers,
      data: { commandId: randomUUID(), basis: (await finance()).work.basis },
    });
    expect(closed.status(), await closed.text()).toBe(200);
    const oldCompletion = await closed.json();
    const oldReceipts = (await finance()).orders.map(
      (o: { payment: unknown }) => o.payment,
    );

    await page.goto(`${origin}/login`);
    await page
      .getByLabel("Usuario", { exact: true })
      .fill("same-day-routes-http");
    await page.getByLabel("Contraseña", { exact: true }).fill(routesPassword);
    await page.getByRole("button", { name: "Entrar al panel" }).click();
    await expect(
      page.getByRole("heading", { name: "Planificar rutas", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Abrir borrador").selectOption(f.planId);
    await expect(
      page.getByText("Ruta finalizada", { exact: true }),
    ).toBeVisible();
    const createDraft = async () => {
      await page
        .getByRole("button", { name: "Nuevo borrador", exact: true })
        .click();
      await page.getByLabel("Fecha de operación").fill(day);
      await page
        .getByLabel("Nombre del plan", { exact: true })
        .fill("prueba 11");
      const pending = page.waitForResponse(
        (r) =>
          r.url() === `${origin}/api/plans` && r.request().method() === "POST",
      );
      const started = Date.now();
      await page
        .getByRole("button", { name: "Crear borrador", exact: true })
        .click();
      const response = await pending;
      timings.creation.push(Date.now() - started);
      expect(response.status()).toBe(201);
      const plan = await response.json();
      await expect(page.getByLabel("Abrir borrador")).toHaveValue(plan.id);
      await expect(
        page.getByRole("heading", { name: "prueba 11", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Sin pedidos cargados", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("status")).toContainText(
        "Nuevo borrador creado",
      );
      return { plan, input: response.request().postDataJSON() };
    };
    const first = await createDraft();
    expect(first.plan.id).not.toBe(f.planId);
    const replay = await page.request.post(`${origin}/api/plans`, {
      headers: { Origin: origin },
      data: first.input,
    });
    expect((await replay.json()).id).toBe(first.plan.id);
    const second = await createDraft();
    expect(second.plan.id).not.toBe(first.plan.id);
    expect(second.input.commandId).not.toBe(first.input.commandId);
    expect(
      (
        await request.post(`${origin}/api/plans`, {
          headers: { Origin: origin },
          data: first.input,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post(`${origin}/api/plans`, {
          headers: { Origin: "https://unauthorized.invalid" },
          data: first.input,
        })
      ).status(),
    ).toBe(403);
    const conflict = await page.request.post(`${origin}/api/plans`, {
      headers: { Origin: origin },
      data: { ...first.input, label: "Reutilización inválida" },
    });
    expect(conflict.status()).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: "PLAN_CREATION_REUSED",
    });
    await page.getByLabel("Abrir borrador").selectOption(first.plan.id);
    const next = await prepareSameDayPlan(f, {
      planId: first.plan.id,
      publish: false,
    });
    const publication = await page.request.post(
      `${origin}/api/plans/${next.planId}/publications`,
      {
        headers: { Origin: origin },
        data: {
          scope: "all",
          expectedVersion: next.board.plan.version,
        },
      },
    );
    expect(publication.status(), await publication.text()).toBe(200);
    const mobileDashboard = async () =>
      (await request.get(`${origin}/api/mobile/dashboard`, { headers })).json();
    expect((await mobileDashboard()).today.plan.id).toBe(next.planId);
    expect(
      (await mobileDashboard()).plans.find(
        (p: { id: string }) => p.id === f.planId,
      ).work_completed_at,
    ).toBe(oldCompletion.completedAt);
    const startUrl = `${origin}/api/mobile/plans/${next.planId}/start`;
    expect(
      (
        await request.post(startUrl, { headers, data: { expectedRevision: 1 } })
      ).status(),
    ).toBe(409);
    for (let index = 0; index < 5; index++) {
      const rgb = randomBytes(3);
      const image = await sharp({
        create: {
          width: 24,
          height: 24,
          channels: 3,
          background: { r: rgb[0], g: rgb[1], b: rgb[2] },
        },
      })
        .jpeg()
        .toBuffer();
      expect(
        (
          await request.post(
            `${origin}/api/mobile/plans/${next.planId}/unit-photos`,
            {
              headers: { ...headers, "Content-Type": "image/jpeg" },
              data: image,
            },
          )
        ).status(),
      ).toBe(201);
    }
    const started = Date.now();
    const start = await request.post(startUrl, {
      headers,
      data: { expectedRevision: 1 },
    });
    timings.start.push(Date.now() - started);
    expect(start.status(), await start.text()).toBe(200);
    expect(await start.json()).toMatchObject({ alreadyStarted: false });
    expect(
      (
        await (
          await request.post(startUrl, {
            headers,
            data: { expectedRevision: 1 },
          })
        ).json()
      ).alreadyStarted,
    ).toBe(true);
    expect(
      (
        await request.post(`${origin}/api/mobile/plans/${f.planId}/start`, {
          headers,
          data: { expectedRevision: 1 },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await request.get(`${origin}/api/mobile/plans/${next.planId}`, {
          headers: { Authorization: f.members[1].authorization },
        })
      ).status(),
    ).toBe(404);
    expect(
      (await finance()).orders.map((o: { payment: unknown }) => o.payment),
    ).toEqual(oldReceipts);
    const live = await (
      await page.request.get(`${origin}/api/live-routes`)
    ).json();
    expect(
      live.routes.some((r: { planId: string }) => r.planId === f.planId),
    ).toBe(false);
    expect(
      live.routes.some((r: { planId: string }) => r.planId === next.planId),
    ).toBe(true);
    await expect(
      page.getByText("Ruta iniciada", { exact: true }),
    ).toBeVisible();
    await mkdir("reports/screenshots", { recursive: true });
    await page.screenshot({
      path: "reports/screenshots/same-day-second-route.png",
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        sameDayTimingsMs: timings,
        independentDrafts: [f.planId, first.plan.id, second.plan.id].length,
      }),
    );
  } finally {
    if (server && server.exitCode === null)
      await new Promise<void>((done) => {
        server!.once("exit", () => done());
        server!.kill();
      });
    await f.close();
  }
});
