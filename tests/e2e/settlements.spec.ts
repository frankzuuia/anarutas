import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { paymentExecutionFixture } from "../helpers/payment-execution";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";
import { createDriver } from "../../src/core/fleet";
import { reportProductIncidentWithEvidence } from "../../src/core/product-incidents-evidence";
import sharp from "sharp";
import { todayInTimezone } from "../../src/core/local-date";

for (const warehouseRequired of [true, false])
  test(`real HTTP collection to settlement, UI roles, individual acceptance and remaining route, warehouse=${warehouseRequired}`, async ({
    page,
    request,
  }) => {
    await settlementFlow(warehouseRequired, { page, request });
  });

async function settlementFlow(
  warehouseRequired: boolean,
  { page, request }: { page: Page; request: APIRequestContext },
) {
  test.setTimeout(180000);
  const serviceDate = todayInTimezone("America/Mexico_City");
  const f = await paymentExecutionFixture({
    collectAtFirstStop: true,
    warehouseRequired,
    now: new Date(`${serviceDate}T17:00:00.000Z`),
  });
  const timings: number[] = [];
  page.on("response", (response) => {
    const timing = response.headers()["server-timing"];
    if (response.url().includes("/api/settlements") && response.ok() && timing)
      timings.push(Number(timing.split("dur=")[1]));
  });
  let server: ChildProcess | undefined;
  try {
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
      [0, "mixed"],
      [1, "transfer"],
      [2, "credit"],
    ] as const) {
      const executionPath = `${origin}/api/mobile/plans/${f.planId}/execution`;
      let execution = await (
        await request.get(executionPath, { headers })
      ).json();
      let stop = execution.stops[index];
      if (index > 0) {
        const arrival = await request.post(
          `${origin}/api/mobile/plans/${f.planId}/stops/${stop.id}/arrival`,
          {
            headers,
            data: {
              commandId: randomUUID(),
              executionId: execution.id,
              publicationRevision: execution.publicationRevision,
              executionRevision: execution.revision,
              stopVersion: stop.version,
              visitSequence: stop.visitSequence,
              policyVersion: execution.policy.version,
              sample: {
                latitude: 20.64,
                longitude: -103.4,
                accuracyMeters: 5,
                ageMilliseconds: 0,
                capturedAt: new Date().toISOString(),
                mock: false,
              },
            },
          },
        );
        expect(arrival.status(), await arrival.text()).toBe(200);
        execution = await (
          await request.get(executionPath, { headers })
        ).json();
        stop = execution.stops[index];
      }
      if (index === 2) {
        await reportProductIncidentWithEvidence(
          f.db.pool,
          f.members[0].authorization,
          f.planId,
          stop.id,
          f.shipmentRows[index].id,
          {
            commandId: randomUUID(),
            executionId: execution.id,
            publicationRevision: execution.publicationRevision,
            executionRevision: execution.revision,
            stopVersion: stop.version,
            visitSequence: stop.visitSequence,
            policyVersion: execution.policy.version,
            orderVersion: stop.orderStates[0].version,
            kind: "return",
            department: "Operaciones",
            concept: "Picking",
            comments: [],
            formVersion: 2,
            financialContractVersion: 1,
            financial: {
              revision: 1,
              moveId: Number(f.shipmentRows[index].picking_id),
              saleLineId: 10,
            },
            lineIndex: 0,
            quantity: "1",
          },
          f.timezone,
          await sharp({
            create: {
              width: 24,
              height: 24,
              channels: 3,
              background: "#334455",
            },
          })
            .jpeg()
            .toBuffer(),
          "image/jpeg",
          f.photoRoot,
        );
        execution = await (
          await request.get(executionPath, { headers })
        ).json();
        stop = execution.stops[index];
      }
      const data = await (await request.get(path, { headers })).json(),
        order = data.orders.find(
          (o: { shipmentId: string }) =>
            o.shipmentId === f.shipmentRows[index].id,
        );
      const payload = {
        commandId: randomUUID(),
        shipmentId: order.shipmentId,
        basis: order.basis,
        captureVersion: 2,
        method,
        tendered: method === "credit" ? "0" : "20",
        ...(method === "mixed"
          ? { cashReceived: "10", transferReceived: "10" }
          : {}),
        change: "0",
        note: index === 0 ? "Pago combinado por cliente" : "",
        attention: {
          planId: f.planId,
          stopId: stop.id,
          publicationRevision: execution.publicationRevision,
          executionRevision: execution.revision,
          stopVersion: stop.version,
          visitSequence: stop.visitSequence,
          orderVersion: stop.orderStates[0].version,
          productIncidentsAcknowledged: true,
        },
      };
      if (index === 0) {
        expect(
          (
            await request.post(`${path}/payments`, {
              headers,
              data: { ...payload, transferReceived: "9.99" },
            })
          ).status(),
        ).toBe(400);
        expect((await f.state()).stops[0].orderStates[0].status).toBe("open");
      }
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
    const navigation = await page
      .getByRole("navigation", { name: "Navegación principal" })
      .getByRole("button")
      .allTextContents();
    const auditIndex = navigation.indexOf("Auditoría");
    expect(navigation.slice(auditIndex, auditIndex + 3)).toEqual([
      "Auditoría",
      "Liquidación de rutas",
      "Control de consumo",
    ]);
    await expect(
      page.getByRole("combobox", { name: "Consultar por", exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("combobox", { name: "Chofer", exact: true })
        .locator("option"),
    ).toHaveCount(3);
    await expect(
      page.getByRole("combobox", { name: "Chofer", exact: true }),
    ).toHaveValue("");
    await page.getByLabel("Desde", { exact: true }).fill(serviceDate);
    await page.getByLabel("Hasta", { exact: true }).fill(serviceDate);
    await page
      .getByRole("button", { name: new RegExp(`Ejecución QA.*${serviceDate}`) })
      .click();
    await expect(
      page.getByRole("heading", { name: /Solicitudes e historial/ }),
    ).toBeVisible();
    const firstCard = page
      .locator(".settlement-order")
      .filter({ hasText: "S1" });
    await expect(
      firstCard.getByRole("button", { name: "Aceptar", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Actualizar", exact: true }),
    ).toHaveCount(1);
    await firstCard.getByRole("button", { name: "Ver pedido y cobro" }).click();
    const orderDetail = page.getByRole("dialog");
    await expect(orderDetail).toContainText("Total original");
    await expect(orderDetail).toContainText("Pago combinado por cliente");
    await expect(orderDetail).toContainText("$20.00 MXN");
    expect(
      await orderDetail
        .locator(".settlement-receipt-heading")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    await expect(firstCard).not.toContainText("Importe original");
    await mkdir(".local/qa-settlements", { recursive: true });
    await page.screenshot({ path: ".local/qa-settlements/order-modal.png" });
    await page.keyboard.press("Escape");
    await expect(orderDetail).toBeHidden();
    await expect(
      firstCard.getByRole("button", { name: "Ver pedido y cobro" }),
    ).toBeFocused();
    await page.getByLabel("Buscar pedido o cliente").fill("ninguno");
    await expect(page.locator(".settlement-order")).toHaveCount(0);
    await page.getByLabel("Buscar pedido o cliente").fill("S1");
    await expect(page.locator(".settlement-order")).toHaveCount(1);
    await page.getByLabel("Buscar pedido o cliente").fill("");
    const returnCard = page
      .locator(".settlement-order")
      .filter({ hasText: "S3" });
    await returnCard
      .getByRole("button", { name: "Ver pedido y cobro" })
      .click();
    await expect(orderDetail.locator(".settlement-incident")).toContainText(
      "Producto 3",
    );
    await expect(orderDetail.locator(".settlement-incident")).toContainText(
      "1 kg",
    );
    await expect(orderDetail.locator(".settlement-incident")).not.toContainText(
      "1.000000",
    );
    await expect(orderDetail.locator(".settlement-incident")).toContainText(
      "− $10.00 MXN",
    );
    await expect(
      orderDetail.getByRole("cell", { name: "Producto 3", exact: true }),
    ).toBeVisible();
    const returnedProduct = orderDetail.getByRole("row").filter({
      hasText: "Producto 3",
    });
    await expect(returnedProduct.getByRole("cell").nth(1)).toHaveText("1 kg");
    await expect(returnedProduct.getByRole("cell").nth(3)).toHaveText(
      "$20.00 MXN",
    );
    await expect(returnedProduct.getByRole("cell").nth(4)).toHaveText(
      "$10.00 MXN",
    );
    await expect(orderDetail.locator(".settlement-order-totals")).toContainText(
      "Total final $10.00 MXN",
    );
    const receiptLayout = await orderDetail.evaluate((dialog) => {
      const products = dialog.querySelector(".settlement-products")!;
      const table = products.querySelector("table")!;
      const wrapper = products.querySelector(".table-wrap")!;
      const totals = dialog.querySelector(".settlement-order-totals")!;
      const incidents = dialog.querySelector(".settlement-incidents")!;
      const row = dialog.querySelector(".settlement-incident")!;
      return {
        tableHeight: table.getBoundingClientRect().height,
        wrapperHeight: wrapper.getBoundingClientRect().height,
        productBottom: products.getBoundingClientRect().bottom,
        totalsTop: totals.getBoundingClientRect().top,
        totalsBottom: totals.getBoundingClientRect().bottom,
        incidentsTop: incidents.getBoundingClientRect().top,
        incidentBackground: getComputedStyle(row).backgroundColor,
      };
    });
    expect(receiptLayout.tableHeight).toBeGreaterThan(60);
    expect(receiptLayout.wrapperHeight).toBeGreaterThanOrEqual(
      receiptLayout.tableHeight,
    );
    expect(receiptLayout.productBottom).toBeLessThanOrEqual(
      receiptLayout.totalsTop,
    );
    expect(receiptLayout.totalsBottom).toBeLessThanOrEqual(
      receiptLayout.incidentsTop,
    );
    expect(receiptLayout.incidentBackground).toBe("rgba(0, 0, 0, 0)");
    await page.screenshot({
      path: ".local/qa-settlements/return-discount-modal.png",
    });
    await page.keyboard.press("Escape");
    const individual = await (
      await request.post(`${path}/requests`, {
        headers,
        data: { commandId: randomUUID(), shipmentId: f.shipmentRows[0].id },
      })
    ).json();
    expect(individual.id).toBeTruthy();
    await expect(
      firstCard.getByRole("button", { name: "Aceptar", exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    await firstCard
      .getByRole("button", { name: "Aceptar", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("20");
    await expect(dialog).toContainText("S1");
    await expect(dialog).toContainText("Efectivo + transferencia");
    for (const name of ["Cancelar", "Aceptar"]) {
      const bounds = await dialog
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
        page.viewportSize()!.height,
      );
    }
    await mkdir(".local/qa-settlements", { recursive: true });
    await page.screenshot({ path: ".local/qa-settlements/confirmation.png" });
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    expect(
      (await (await request.get(path, { headers })).json()).requests[0].status,
    ).toBe("pending");
    await firstCard
      .getByRole("button", { name: "Aceptar", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Aceptar", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(
        async () =>
          (await (await request.get(path, { headers })).json()).requests.find(
            (r: { id: string }) => r.id === individual.id,
          ).status,
      )
      .toBe("accepted");
    expect((await f.state()).completedAt).toBeNull();
    if (warehouseRequired) await f.finish();
    const reviewed = await (await request.get(path, { headers })).json();
    expect(reviewed.routeSettlement.warehouseRequired).toBe(warehouseRequired);
    expect(reviewed.routeSettlement.eligible).toBe(true);
    expect(reviewed.route.completedAt === null).toBe(!warehouseRequired);
    expect(reviewed.routeSettlement.paymentIds).toHaveLength(2);
    expect(
      (
        await request.post(`${path}/work`, {
          headers,
          data: { commandId: randomUUID(), basis: reviewed.work.basis },
        })
      ).status(),
    ).toBe(409);
    const rest = await request.post(`${path}/requests`, {
      headers,
      data: {
        commandId: randomUUID(),
        shipmentId: null,
        basis: reviewed.routeSettlement.basis,
      },
    });
    expect(rest.status()).toBe(200);
    const routeCard = page.locator(".settlement-route-card");
    await expect(
      routeCard.getByRole("button", {
        name: "Aceptar liquidación de ruta",
        exact: true,
      }),
    ).toBeEnabled({ timeout: 15000 });
    await routeCard.locator(".settlement-route-open").click();
    const packetDialog = page.getByRole("dialog", {
      name: /Liquidación de ruta/,
    });
    await expect(packetDialog.locator(".settlement-packet-order")).toHaveCount(
      2,
    );
    await expect(packetDialog).not.toContainText("S1");
    const closePacketBounds = await packetDialog
      .getByRole("button", { name: "Cerrar liquidación de ruta" })
      .boundingBox();
    const packetTitleBounds = await packetDialog
      .getByRole("heading", { name: /Liquidación de ruta/ })
      .boundingBox();
    expect(closePacketBounds!.x).toBeGreaterThan(packetTitleBounds!.x);
    expect(Math.abs(closePacketBounds!.y - packetTitleBounds!.y)).toBeLessThan(
      44,
    );
    await packetDialog
      .locator(".settlement-packet-order")
      .filter({ hasText: "S3" })
      .click();
    await expect(
      orderDetail
        .getByRole("row")
        .filter({ hasText: "Producto 3" })
        .getByRole("cell")
        .nth(1),
    ).toHaveText("1 kg");
    await expect(orderDetail.locator(".settlement-incident")).toContainText(
      "− $10.00 MXN",
    );
    await page.keyboard.press("Escape");
    await expect(packetDialog).toBeVisible();
    await page.screenshot({ path: ".local/qa-settlements/route-packet.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: ".local/qa-settlements/route-packet-mobile.png",
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await packetDialog
      .getByRole("button", { name: "Cancelar", exact: true })
      .click();
    expect(
      (await (await request.get(path, { headers })).json()).requests.find(
        (r: { scope: string }) => r.scope === "route",
      ).status,
    ).toBe("pending");
    await routeCard.locator(".settlement-route-open").click();
    await packetDialog
      .getByRole("button", {
        name: "Aceptar liquidación de ruta",
        exact: true,
      })
      .click();
    await expect(dialog).toContainText("20");
    await dialog.getByRole("button", { name: "Aceptar", exact: true }).click();
    await expect(
      packetDialog.getByRole("button", { name: "Recibida", exact: true }),
    ).toBeDisabled();
    await packetDialog
      .getByRole("button", { name: "Cancelar", exact: true })
      .click();
    const after = await (await request.get(path, { headers })).json();
    expect(after.outstandingTotals).toEqual([]);
    expect(after.acceptedTotals[0]).toMatchObject({
      cash: "10",
      transfer: "30",
      credit: "10",
      balance: "0",
    });
    expect(after.work).toMatchObject({
      eligible: true,
      completion: null,
      summary: {
        deliveredOrders: 3,
        incidents: 1,
        totals: [{ total: "50" }],
      },
    });
    const workPayload = { commandId: randomUUID(), basis: after.work.basis };
    expect(
      (await request.post(`${path}/work`, { data: workPayload })).status(),
    ).toBe(401);
    expect(
      (
        await request.post(`${path}/work`, {
          headers: { Authorization: f.members[1].authorization },
          data: workPayload,
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post(`${path}/work`, {
          headers,
          data: { ...workPayload, basis: "0".repeat(64) },
        })
      ).status(),
    ).toBe(409);
    const workTimings: number[] = [];
    const completeWork = async () => {
      const started = performance.now();
      const response = await request.post(`${path}/work`, {
        headers,
        data: workPayload,
      });
      workTimings.push(performance.now() - started);
      return response;
    };
    const completedWork = await Promise.all([completeWork(), completeWork()]);
    for (const response of completedWork)
      expect(response.status(), await response.text()).toBe(200);
    const summaries = await Promise.all(
      completedWork.map((response) => response.json()),
    );
    expect(summaries.map((s) => s.duplicate).sort()).toEqual([false, true]);
    expect(summaries[0].summary).toEqual(after.work.summary);
    const executionPath = `${origin}/api/mobile/plans/${f.planId}/execution`;
    const closedExecution = await (
      await request.get(executionPath, { headers })
    ).json();
    expect(closedExecution.completedAt).toBe(summaries[0].completedAt);
    const closedPlan = await (
      await request.get(`${origin}/api/mobile/plans/${f.planId}`, { headers })
    ).json();
    expect(closedPlan.publication.workCompletedAt).toBe(
      summaries[0].completedAt,
    );
    expect(closedPlan.orders).toHaveLength(3);
    const closedDashboard = await (
      await request.get(`${origin}/api/mobile/dashboard`, { headers })
    ).json();
    expect(closedDashboard.today).toBeNull();
    expect(
      closedDashboard.plans.find((p: { id: string }) => p.id === f.planId),
    ).toMatchObject({ work_completed_at: summaries[0].completedAt });
    await writeFile(
      ".local/qa-settlements/work-command-timing.json",
      JSON.stringify(
        {
          samples: workTimings,
          maximumMs: Math.max(...workTimings),
          environment:
            "two concurrent same-command HTTP requests, isolated local PostgreSQL and Next production build; not a load test or production SLO",
        },
        null,
        2,
      ),
    );
    expect(
      (
        await (
          await request.post(`${path}/work`, { headers, data: workPayload })
        ).json()
      ).duplicate,
    ).toBe(true);
    expect(
      (await (await request.get(path, { headers })).json()).work.completion
        .summary,
    ).toEqual(after.work.summary);
    await mkdir(".local/qa-settlements", { recursive: true });
    await page.locator(".settlement-history > summary").click();
    await page.screenshot({
      path: ".local/qa-settlements/receiver.png",
      fullPage: true,
    });
    await page.locator(".settlement-history > summary").click();
    await page.screenshot({
      path: ".local/qa-settlements/receiver-compact.png",
      fullPage: true,
    });
    const driverFilter = page.getByRole("combobox", {
      name: "Chofer",
      exact: true,
    });
    const blocker = await f.db.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE route_drivers IN ACCESS EXCLUSIVE MODE");
      const earlier = page.waitForRequest(
        (r) =>
          r.url().includes(`/api/settlements?`) &&
          r.url().includes(f.members[0].driverId),
      );
      await driverFilter.selectOption(f.members[0].driverId);
      await earlier;
      const later = page.waitForRequest(
        (r) =>
          r.url().includes(`/api/settlements?`) &&
          r.url().includes(f.members[1].driverId),
      );
      await driverFilter.selectOption(f.members[1].driverId);
      await later;
      await blocker.query("COMMIT");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    await expect(driverFilter).toHaveValue(f.members[1].driverId);
    await driverFilter.selectOption(f.members[1].driverId);
    await expect(
      page.getByText("No hay pedidos cobrados en estas fechas.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".settlement-method strong")).toHaveCount(0);
    await driverFilter.selectOption(f.members[0].driverId);
    const routeButton = page.getByRole("button", {
      name: new RegExp(`Ejecución QA.*${serviceDate}`),
    });
    await routeButton.click();
    await page
      .getByRole("button", { name: "Volver a choferes", exact: true })
      .click();
    await expect(driverFilter).toHaveValue(f.members[0].driverId);
    await expect(routeButton).toBeVisible();
    const lateDriver = await createDriver(f.db.pool, f.actor, {
      id: randomUUID(),
      name: "Chofer registrado en vivo",
      phone: "3310000004",
      emergency_name: "",
      emergency_phone: "",
      blood_type: "",
      active: false,
    });
    // Actual PG notification/SSE updates the minimal roster while keeping the selected scope.
    await expect(
      driverFilter.locator("option", {
        hasText: "Chofer registrado en vivo · Inactivo",
      }),
    ).toHaveCount(1);
    await expect(driverFilter).toHaveValue(f.members[0].driverId);
    await driverFilter.selectOption(lateDriver.id);
    await expect(
      page.getByText("No hay pedidos cobrados en estas fechas.", {
        exact: true,
      }),
    ).toBeVisible();
    await driverFilter.selectOption("");
    await expect(routeButton).toBeVisible();
    await routeButton.click();
    const nextDay = new Date(`${serviceDate}T12:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextDate = nextDay.toISOString().slice(0, 10);
    await page.getByLabel("Hasta", { exact: true }).fill(nextDate);
    await expect(
      page.getByRole("button", { name: "Volver a choferes", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Desde", { exact: true }).fill(nextDate);
    await expect(
      page.getByText("No hay pedidos cobrados en estas fechas.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".settlement-method strong")).toHaveCount(0);
    await expect(driverFilter).toHaveValue("");
    await page.getByLabel("Desde", { exact: true }).fill(serviceDate);
    await page.getByLabel("Hasta", { exact: true }).fill(serviceDate);
    await expect(routeButton).toBeVisible();
    await expect(page.getByText("Página 1", { exact: true })).toBeVisible();
    // Preserve the existing API compatibility for receipt dates without exposing another UI choice.
    const receiptDate = todayInTimezone(f.timezone);
    await expect(
      page.getByRole("heading", {
        name: "Cobrado por choferes",
        exact: true,
      }),
    ).toBeVisible();
    const receiptReport = await (
      await page.request.get(
        `${origin}/api/settlements?dateBasis=receipt&from=${receiptDate}&to=${receiptDate}`,
      )
    ).json();
    expect(receiptReport.metrics).toMatchObject([
      { stage: "accepted", cash: "10", transfer: "30", credit: "10" },
    ]);
    expect(
      (
        await page.request.get(`${origin}/api/settlements?driverId=invalid`)
      ).status(),
    ).toBe(400);
    expect(
      receiptReport.drivers.every(
        (d: Record<string, unknown>) =>
          Object.keys(d).sort().join(",") === "active,id,name",
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    const controls = page.locator(".settlement-filters");
    const bounds = await controls.locator("label").evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width };
      }),
    );
    expect(bounds.map((b) => Math.round(b.width))).toEqual([160, 160, 220]);
    expect(new Set(bounds.map((b) => Math.round(b.y))).size).toBe(1);
    expect(bounds[2].x).toBeGreaterThan(bounds[1].x);
    const heights = await controls
      .locator("input,select,button")
      .evaluateAll((elements) =>
        elements.map((e) => e.getBoundingClientRect().height),
      );
    expect(heights.every((h) => h >= 44)).toBe(true);
    await page.screenshot({
      path: `.local/qa-settlements/filters-desktop-${warehouseRequired}.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/qa-settlements/filters-mobile-${warehouseRequired}.png`,
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
    const closedLive = await (
      await page.request.get(`${origin}/api/live-routes`)
    ).json();
    expect(
      closedLive.routes.some((r: { id: string }) => r.id === f.executionId),
    ).toBe(false);
    await page
      .getByRole("button", { name: "Planificar rutas", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Abrir borrador", exact: true })
      .selectOption(f.planId);
    const finalizedLane = page
      .locator(".lane.order-lane")
      .filter({ hasText: "Unidad 0" });
    await expect(finalizedLane).toContainText("Ruta finalizada");
    await expect(
      finalizedLane.getByRole("button", { name: "Cancelar ruta", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: `.local/qa-settlements/closure-planner-${warehouseRequired}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Usuarios y accesos", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Añadir liquidador", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Añadir administrador",
        exact: true,
      }),
    ).toBeVisible();
    const accountForms = [
      {
        role: "routes",
        title: "Crear administrador de rutas",
        name: "María José Pérez",
        login: "maria rutas",
      },
      {
        role: "settlement",
        title: "Crear liquidador",
        name: "Ángel López Méndez",
        login: "angel liquidacion",
      },
    ] as const;
    const settlementForm = page.getByRole("form", {
      name: "Crear liquidador",
      exact: true,
    });
    await settlementForm
      .getByLabel("Nombre completo", { exact: true })
      .fill("Borrador conservado");
    for (const account of accountForms) {
      const form = page.getByRole("form", {
        name: account.title,
        exact: true,
      });
      const fullName = form.getByLabel("Nombre completo", { exact: true });
      const username = form.getByLabel("Usuario", { exact: true });
      const secret = form.getByLabel("Contraseña", { exact: true });
      for (const field of [fullName, username]) {
        await expect(field).toHaveAttribute("type", "text");
        await expect(field).toHaveAttribute("inputmode", "text");
      }
      await expect(fullName).toHaveAttribute(
        "id",
        `account-${account.role}-full-name`,
      );
      await expect(fullName).toHaveAttribute(
        "autocomplete",
        `section-${account.role} name`,
      );
      await expect(username).toHaveAttribute(
        "id",
        `account-${account.role}-username`,
      );
      await expect(username).toHaveAttribute(
        "autocomplete",
        `section-${account.role} username`,
      );
      await expect(secret).toHaveAttribute(
        "autocomplete",
        `section-${account.role} new-password`,
      );
      await expect(username).toHaveAccessibleDescription(
        "Usuario interno; no requiere correo electrónico.",
      );
      await username.fill("");
      expect(
        await username.evaluate(
          (input: HTMLInputElement) => input.validity.valueMissing,
        ),
      ).toBe(true);
      await fullName.fill(account.name);
      await username.fill(account.login);
      const createdPassword = randomUUID();
      await secret.fill(createdPassword);
      expect(
        await form.evaluate((element: HTMLFormElement) =>
          element.checkValidity(),
        ),
      ).toBe(true);
      const saved = page.waitForResponse(
        (response) =>
          response.url() === `${origin}/api/users` &&
          response.request().method() === "POST",
      );
      await form
        .getByRole("button", { name: "Crear cuenta", exact: true })
        .click();
      const savedResponse = await saved;
      expect(savedResponse.ok()).toBe(true);
      expect(await savedResponse.json()).toMatchObject({
        name: account.name,
        login: account.login,
        role: account.role,
      });
      await expect(
        form.getByLabel("Nombre completo", { exact: true }),
      ).toHaveValue("");
      const storedUsers = await (
        await page.request.get(`${origin}/api/users`)
      ).json();
      expect(storedUsers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: account.name,
            login: account.login,
            role: account.role,
          }),
        ]),
      );
      const session = await request.post(`${origin}/api/session`, {
        headers: { Origin: origin },
        data: { login: account.login, password: createdPassword },
      });
      expect(session.ok()).toBe(true);
      expect(
        await (await request.get(`${origin}/api/session`)).json(),
      ).toMatchObject({
        name: account.name,
        login: account.login,
        role: account.role,
      });
      expect((await request.get(`${origin}/api/users`)).status()).toBe(
        account.role === "routes" ? 200 : 403,
      );
      expect((await request.get(`${origin}/api/settlements`)).status()).toBe(
        account.role === "settlement" ? 200 : 403,
      );
      await request.delete(`${origin}/api/session`, {
        headers: { Origin: origin },
        data: {},
      });
      if (account.role === "routes") {
        await expect(
          settlementForm.getByLabel("Nombre completo", { exact: true }),
        ).toHaveValue("Borrador conservado");
      }
    }
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
}
