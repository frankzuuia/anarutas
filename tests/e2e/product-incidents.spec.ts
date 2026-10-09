import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { executionFixture } from "../helpers/driver-execution";
import { freePort } from "../helpers/postgres";
import { createUser } from "../../src/core/auth";
import { readDriverExecution } from "../../src/core/driver-execution-read";
import { executeStopCommand } from "../../src/core/driver-stop-command";
import { executeDriverOrderCommand } from "../../src/core/driver-order-command";
import { reportProductIncidentWithEvidence } from "../../src/core/product-incidents-evidence";
import {
  resolveProductIncident,
  reportProductIncident,
} from "../../src/core/product-incidents";
import { cancelPublishedRoute } from "../../src/core/route-publications";

let f: Awaited<ReturnType<typeof executionFixture>>;
let server: ChildProcess;
let origin: string;
const login = `product-${randomUUID()}`,
  password = randomUUID();

test("IO reconnect: real offline recovery drains 105 arrivals once and leaving the panel stops audio", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  expect(
    (
      await page.request.post(`${origin}/api/session`, {
        headers: { Origin: origin },
        data: { login, password },
      })
    ).status(),
  ).toBe(200);
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Incidencias en vivo", exact: true })
    .click();
  await page.getByText("Configuración de alarma", { exact: true }).click();
  await page.getByRole("button", { name: "Activar sonido" }).click();
  await expect(
    page.getByText("Reproduciendo alarma…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Reproduciendo alarma…", { exact: true }),
  ).toHaveCount(0, { timeout: 6500 });
  await context.setOffline(true);
  try {
    const route = await readDriverExecution(
        f.db.pool,
        f.members[0].driverId,
        f.planId,
        f.timezone,
      ),
      stop = route.stops[0];
    const incident = await reportProductIncident(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stop.id,
      stop.shipmentIds[0],
      {
        commandId: randomUUID(),
        executionId: route.id,
        publicationRevision: route.publicationRevision,
        executionRevision: route.revision,
        stopVersion: stop.version,
        visitSequence: stop.visitSequence,
        orderVersion: stop.orderStates[0].version,
        formVersion: 3,
        kind: "shortage_validation",
        quantity: "1",
        product: "Faltante recuperado",
        unit: "kg",
        department: "Compras",
        concept: "Error en compra",
        comments: ["late_arrival"],
      },
      f.timezone,
      f.now,
    );
    for (let i = 0; i < 104; i++)
      await f.db.pool.query(
        `INSERT INTO route_product_incidents(id,execution_id,stop_id,shipment_id,driver_id,visit_sequence,kind,product,unit,quantity,note,order_name,occurred_at,event_date,timezone,snapshot,department,concept)
      SELECT $1,execution_id,stop_id,shipment_id,driver_id,visit_sequence,kind,product,unit,quantity,note,order_name,occurred_at,event_date,timezone,snapshot,department,concept FROM route_product_incidents WHERE id=$2`,
        [randomUUID(), incident.incidentId],
      );
  } finally {
    await context.setOffline(false);
  }
  await expect(
    page.getByText("Reproduciendo alarma…", { exact: true }),
  ).toBeVisible({ timeout: 18000 });
  const source = await (
    await page.request.get(`${origin}/api/incidents/alerts`)
  ).json();
  await expect
    .poll(() =>
      page.evaluate(
        (key) => localStorage.getItem(key),
        `ana-incidents:${source.scope}`,
      ),
    )
    .toBe(source.cursor);
  const rows = page.locator(".incident-board-routes .live-incident-card");
  await expect(rows).toHaveCount(50);
  await expect(page.locator(".incident-board-routes > .toolbar")).toContainText(
    "105",
  );
  await expect(
    page.getByText("Reproduciendo alarma…", { exact: true }),
  ).toHaveCount(0, { timeout: 6500 });
  await page
    .getByRole("button", { name: "Más incidencias", exact: true })
    .click();
  await expect(rows).toHaveCount(50);
  await expect(
    page.getByText("Reproduciendo alarma…", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Más incidencias", exact: true })
    .click();
  await expect(rows).toHaveCount(5);
  await page.getByRole("button", { name: "Probar sonido" }).click();
  await expect(
    page.getByText("Reproduciendo alarma…", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Incidencias", exact: true }).click();
  await page
    .getByRole("button", { name: "Incidencias en vivo", exact: true })
    .click();
  await page.getByText("Configuración de alarma", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Activar sonido" }),
  ).toBeVisible();
  await expect(
    page.getByText("Reproduciendo alarma…", { exact: true }),
  ).toHaveCount(0);
});

test("IO panel: shared seen, real audio 5/10/15 seconds, two tabs, comments and mobile layout", async ({
  page,
  browser,
  context,
  request,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const session = async (
    target: typeof page,
    account = login,
    secret = password,
  ) => {
    expect(
      (
        await target.request.post(`${origin}/api/session`, {
          headers: { Origin: origin },
          data: { login: account, password: secret },
        })
      ).status(),
    ).toBe(200);
    await target.goto(origin);
    await target
      .getByRole("button", { name: "Incidencias en vivo", exact: true })
      .click();
    await target.getByText("Configuración de alarma", { exact: true }).click();
  };
  for (const path of ["board", "alerts"])
    expect(
      (await request.get(`${origin}/api/incidents/${path}`)).status(),
    ).toBe(401);
  expect(
    (
      await request.post(`${origin}/api/incidents/seen`, {
        headers: { Origin: origin },
        data: { key: `product:${randomUUID()}` },
      })
    ).status(),
  ).toBe(401);
  await session(page);
  const second = await context.newPage();
  await second.goto(origin);
  await second
    .getByRole("button", { name: "Incidencias en vivo", exact: true })
    .click();
  await second.getByText("Configuración de alarma", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Activar sonido" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Activar sonido" }).click();
  await expect(
    page.getByText("Reproduciendo alarma…", { exact: true }),
  ).toBeVisible();
  await second.getByRole("button", { name: "Activar sonido" }).click();
  await expect(
    second.getByText("Reproduciendo alarma…", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Reproduciendo alarma…", { exact: true }),
  ).toHaveCount(0, { timeout: 6500 });
  for (const seconds of [10, 15]) {
    await page
      .getByLabel("Duración de alarma", { exact: true })
      .selectOption(String(seconds));
    await expect(
      second.getByLabel("Duración de alarma", { exact: true }),
    ).toHaveValue(String(seconds));
    const measured = page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let started: number | null = null;
          const observer = new MutationObserver(() => {
            const playing = Array.from(
              document.querySelectorAll('[role="status"]'),
            ).some((node) => node.textContent === "Reproduciendo alarma…");
            if (playing && started === null) started = performance.now();
            if (!playing && started !== null) {
              observer.disconnect();
              resolve(performance.now() - started);
            }
          });
          observer.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
          });
        }),
    );
    await page.getByRole("button", { name: "Probar sonido" }).click();
    await expect(
      page.getByText("Reproduciendo alarma…", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Reproduciendo alarma…", { exact: true }),
    ).toHaveCount(0, { timeout: (seconds + 2) * 1000 });
    const duration = await measured;
    console.log(`IO audio ${seconds}s: ${Math.round(duration)}ms`);
    expect(Math.abs(duration - seconds * 1000)).toBeLessThan(500);
  }
  await page
    .getByLabel("Duración de alarma", { exact: true })
    .selectOption("5");
  await expect(
    second.getByLabel("Duración de alarma", { exact: true }),
  ).toHaveValue("5");
  const otherLogin = randomUUID(),
    otherPassword = randomUUID();
  await createUser(f.db.pool, f.actor, {
    name: "Administradora B",
    login: otherLogin,
    password: otherPassword,
  });
  const otherContext = await browser.newContext(),
    other = await otherContext.newPage();
  try {
    await session(other, otherLogin, otherPassword);
    await page
      .getByLabel("Chofer", { exact: true })
      .selectOption(f.members[1].driverId);
    const route = await readDriverExecution(
        f.db.pool,
        f.members[0].driverId,
        f.planId,
        f.timezone,
      ),
      stop = route.stops[0];
    const started = performance.now();
    const captured = await reportProductIncident(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stop.id,
      stop.shipmentIds[0],
      {
        commandId: randomUUID(),
        executionId: route.id,
        publicationRevision: route.publicationRevision,
        executionRevision: route.revision,
        stopVersion: stop.version,
        visitSequence: stop.visitSequence,
        orderVersion: stop.orderStates[0].version,
        formVersion: 3,
        kind: "shortage_validation",
        quantity: "1",
        product: "Faltante visible",
        unit: "kg",
        department: "Compras",
        concept: "Error en compra",
        comments: ["late_arrival"],
        note: "Nota del chofer",
      },
      f.timezone,
      f.now,
    );
    const selector = `[data-incident-key="product:${captured.incidentId}"]`;
    await expect(other.locator(selector)).toHaveClass(/incident-unseen/);
    console.log(
      `IO shared board propagation ${Math.round(performance.now() - started)}ms`,
    );
    await expect(
      page.getByText(/incidencias sin ver fuera del filtro/),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await page
            .getByText("Reproduciendo alarma…", { exact: true })
            .count()) +
          (await second
            .getByText("Reproduciendo alarma…", { exact: true })
            .count()),
      )
      .toBe(1);
    expect(
      (
        await page.request.post(`${origin}/api/incidents/seen`, {
          headers: { Origin: "https://foreign.invalid" },
          data: { key: `product:${captured.incidentId}` },
        })
      ).status(),
    ).toBe(403);
    await other
      .locator(selector)
      .getByRole("checkbox", { name: "Visto", exact: true })
      .click();
    await expect(
      other
        .locator(selector)
        .getByRole("checkbox", { name: "Visto", exact: true }),
    ).toBeChecked();
    await expect(second.locator(selector)).not.toHaveClass(/incident-unseen/);
    await expect(second.locator(selector)).toContainText(
      "Visto por Administradora B",
    );
    await expect(
      page.getByText("Reproduciendo alarma…", { exact: true }),
    ).toHaveCount(0);
    await expect(
      second.getByText("Reproduciendo alarma…", { exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await f.db.pool.query(
          "SELECT status,quantity::text FROM route_product_incidents WHERE id=$1",
          [captured.incidentId],
        )
      ).rows[0],
    ).toMatchObject({ status: "pending", quantity: "1.000000" });
    await page
      .getByRole("button", { name: "Incidencias", exact: true })
      .click();
    await page.getByLabel("Desde", { exact: true }).fill("2026-09-24");
    await page.getByLabel("Hasta", { exact: true }).fill("2026-09-24");
    await page.getByRole("button", { name: "Editar clasificación" }).click();
    const dialog = page.getByRole("dialog", { name: "Editar clasificación" });
    await dialog
      .getByLabel("Comentarios", { exact: true })
      .fill("Revisado por administración");
    await dialog.getByRole("button", { name: "Guardar clasificación" }).click();
    await expect(second.locator(selector)).toContainText(
      "Revisado por administración",
    );
    await expect(second.locator(selector)).not.toContainText("Error en compra");
    await expect(
      second.getByText("Reproduciendo alarma…", { exact: true }),
    ).toHaveCount(0);
    await second.reload();
    await second
      .getByRole("button", { name: "Incidencias en vivo", exact: true })
      .click();
    await expect(second.locator(selector)).toContainText(
      "Visto por Administradora B",
    );
    await page
      .getByRole("button", { name: "Incidencias en vivo", exact: true })
      .click();
    await page.getByLabel("Chofer", { exact: true }).selectOption("");
    await page.getByLabel("Desde", { exact: true }).fill("");
    await page.getByLabel("Hasta", { exact: true }).fill("");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(selector)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await mkdir(".local/qa/incident-organization", { recursive: true });
    await page.screenshot({
      path: ".local/qa/incident-organization/board-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.screenshot({
      path: ".local/qa/incident-organization/board-desktop.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await otherContext.close();
    await second.close();
  }
});

test("IO v3: real HTTP capture, return excluded and audited comment reflected in Chrome and unchanged Excel", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const bytes = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#8cab33" },
  })
    .jpeg()
    .toBuffer();
  const latest = () =>
    readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
  const initial = await latest(),
    stop = initial.stops[0],
    shipment = stop.shipmentIds[0];
  const path = `${origin}/api/mobile/plans/${f.planId}/stops/${stop.id}/orders/${shipment}/product-incidents`;
  const identity = async () => {
    const route = await latest(),
      current = route.stops[0];
    return {
      commandId: randomUUID(),
      executionId: route.id,
      publicationRevision: route.publicationRevision,
      executionRevision: route.revision,
      stopVersion: current.version,
      visitSequence: current.visitSequence,
      orderVersion: current.orderStates[0].version,
    };
  };
  const headers = { Authorization: f.members[0].authorization };
  const returned = {
    ...(await identity()),
    formVersion: 3,
    kind: "return",
    lineIndex: 0,
    quantity: "0.25",
    comments: ["damaged_product"],
    note: "Devolución de prueba actual",
  };
  expect((await request.post(path, { headers, data: returned })).status()).toBe(
    400,
  );
  const withPhoto = (raw: unknown) =>
    request.post(path, {
      headers,
      multipart: {
        command: JSON.stringify(raw),
        photos: { name: "evidence.jpg", mimeType: "image/jpeg", buffer: bytes },
      },
    });
  const returnResponse = await withPhoto(returned);
  expect(returnResponse.status()).toBe(201);
  const returnId = (await returnResponse.json()).incidentId;
  expect((await (await withPhoto(returned)).json()).duplicate).toBe(true);
  const replacement = {
    ...(await identity()),
    formVersion: 3,
    kind: "replacement_quality",
    lineIndex: 0,
    quantity: "0.25",
    department: "Compras",
    concept: "Error en compra",
    comments: ["product_not_ordered"],
    note: "Comentario original",
  };
  const replacementResponse = await withPhoto(replacement);
  expect(replacementResponse.status()).toBe(201);
  const incidentId = (await replacementResponse.json()).incidentId;
  const classification = `${origin}/api/incidents/products/${incidentId}/classification`;
  const edit = {
    expectedVersion: 1,
    department: "Operaciones",
    concept: "Error en compra",
    comment: "Comentario corregido por administración",
  };
  expect(
    (
      await request.patch(classification, {
        headers: { Origin: origin },
        data: edit,
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.post(`${origin}/api/session`, {
        headers: { Origin: origin },
        data: { login, password },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.patch(classification, {
        headers: { Origin: "https://foreign.invalid" },
        data: edit,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.patch(classification, {
        headers: { Origin: origin },
        data: { ...edit, quantity: "9" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.patch(
        `${origin}/api/incidents/products/${returnId}/classification`,
        { headers: { Origin: origin }, data: edit },
      )
    ).status(),
  ).toBe(404);
  const started = performance.now();
  expect(
    (
      await page.request.patch(classification, {
        headers: { Origin: origin },
        data: edit,
      })
    ).status(),
  ).toBe(200);
  console.log(
    `IO audited classification HTTP: ${Math.round(performance.now() - started)} ms`,
  );
  expect(
    (
      await page.request.patch(classification, {
        headers: { Origin: origin },
        data: edit,
      })
    ).status(),
  ).toBe(409);
  const report = await (
    await page.request.get(`${origin}/api/incidents/products`)
  ).json();
  expect(report.rows.map((row: { id: string }) => row.id)).toEqual([
    incidentId,
  ]);
  expect(report.rows[0]).toMatchObject({
    note: edit.comment,
    originalNote: "No venía el producto en el pedido\nComentario original",
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    (await (
      await page.request.get(`${origin}/api/incidents/products/export`)
    ).body()) as never,
  );
  const sheet = book.getWorksheet("Incidencias")!;
  expect(sheet.columnCount).toBe(9);
  expect(sheet.rowCount).toBe(2);
  expect(sheet.getCell("H2").value).toBe(edit.comment);
  expect(sheet.getCell("D2").value).toBe(0.25);
  expect(
    (
      await page.request.get(
        `${origin}/api/incidents/products/${returnId}/evidence`,
      )
    ).status(),
  ).toBe(200);
  await page.goto(origin);
  await page.getByRole("button", { name: "Incidencias", exact: true }).click();
  const history = page.getByRole("region", {
    name: "Incidencias por producto",
    exact: true,
  });
  await expect(history).toContainText(edit.comment);
  await expect(history).not.toContainText(returned.note);
  await page
    .getByRole("button", { name: "Incidencias en vivo", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Incidencias de ruta", exact: true }),
  ).toContainText(edit.comment);
  await mkdir(".local/qa/incident-organization", { recursive: true });
  await page.screenshot({
    path: ".local/qa/incident-organization/comment-live.png",
    fullPage: true,
  });
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int n FROM route_product_incidents",
      )
    ).rows[0].n,
  ).toBe(2);
  expect((await latest()).stops[0].orderStates[0].status).toBe("open");
});
test.beforeEach(async () => {
  test.setTimeout(120_000);
  f = await executionFixture();
  await f.start();
  await createUser(f.db.pool, f.actor, { name: "Product QA", login, password });
  const execution = await readDriverExecution(
      f.db.pool,
      f.members[0].driverId,
      f.planId,
      f.timezone,
    ),
    stop = execution.stops[0];
  await executeStopCommand(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stop.id,
    "arrival",
    {
      commandId: randomUUID(),
      executionId: execution.id,
      publicationRevision: execution.publicationRevision,
      executionRevision: execution.revision,
      stopVersion: stop.version,
      policyVersion: execution.policy.version,
      sample: {
        latitude: 20.64,
        longitude: -103.4,
        accuracyMeters: 5,
        ageMilliseconds: 0,
        capturedAt: f.now.toISOString(),
        mock: false,
      },
    },
    f.timezone,
    f.now,
  );
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
        RUTAS_DATABASE_URL: f.db.config.databaseUrl,
        RUTAS_INSTANCE_ID: f.db.config.instanceId,
        RUTAS_BOOTSTRAP_TOKEN: f.db.config.bootstrapToken,
        RUTAS_APP_ORIGIN: origin,
        RUTAS_TIMEZONE: f.timezone,
        RUTAS_UNIT_PHOTO_DIR: f.photoRoot,
        RUTAS_GOOGLE_MAPS_BROWSER_KEY: "",
        RUTAS_GOOGLE_MAP_ID: "",
        ODOO_URL: "",
        ODOO_DATABASE: "",
        ODOO_EMAIL: "",
        ODOO_API_KEY: "",
      },
    },
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/api/ready`)).ok) return;
    } catch {
      /* local server startup */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("PRODUCT_SERVER_NOT_READY");
});
test.afterEach(async () => {
  if (server && server.exitCode === null)
    await new Promise<void>((resolve) => {
      server.once("exit", () => resolve());
      server.kill();
    });
  await f?.close();
});

test("mobile report → live visibility → admin classification → exact private Excel → resolution", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const route = await readDriverExecution(
      f.db.pool,
      f.members[0].driverId,
      f.planId,
      f.timezone,
    ),
    stop = route.stops[0];
  const path = `${origin}/api/mobile/plans/${f.planId}/stops/${stop.id}/orders/${stop.shipmentIds[0]}/product-incidents`;
  const data = {
    commandId: randomUUID(),
    executionId: route.id,
    publicationRevision: route.publicationRevision,
    executionRevision: route.revision,
    stopVersion: stop.version,
    visitSequence: stop.visitSequence,
    orderVersion: stop.orderStates[0].version,
    kind: "replacement_quality",
    department: "Ventas",
    lineIndex: 0,
    quantity: "0.25",
    note: "Producto dañado",
    formVersion: 2,
    concept: "Picking",
    comments: ["customer_specifications", "order_quantity_changed"],
  };
  for (const apiPath of [
    "/api/incidents/products",
    "/api/incidents/products/export",
  ])
    expect((await request.get(origin + apiPath)).status()).toBe(401);
  expect((await request.post(path, { data })).status()).toBe(401);
  expect(
    (
      await request.post(path, {
        data,
        headers: { Authorization: f.members[1].authorization },
      })
    ).status(),
  ).toBe(404);
  const headers = { Authorization: f.members[0].authorization };
  expect((await request.post(path, { headers, data })).status()).toBe(400);
  const photo = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#779f32" },
  })
    .jpeg()
    .toBuffer();
  const withPhoto = (command = data, count = 3) => {
    const boundary = `Test-${randomUUID()}`;
    const body = [
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="command"\r\n\r\n${JSON.stringify(command)}`,
      ),
    ];
    for (let index = 0; index < count; index++)
      body.push(
        Buffer.from(
          `\r\n--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="${index}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
        ),
        photo,
      );
    body.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    return {
      data: Buffer.concat(body),
      headers: {
        ...headers,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
    };
  };
  expect(
    (
      await request.post(path, {
        data: photo,
        headers: {
          ...headers,
          "Content-Type": "image/jpeg",
          "X-Ana-Rutas-Command": "[]",
        },
      })
    ).status(),
  ).toBe(400);
  const started = performance.now();
  expect((await request.post(path, withPhoto(data, 4))).status()).toBe(400);
  const response = await request.post(path, withPhoto());
  expect(response.status()).toBe(201);
  const receipt = await response.json();
  expect(
    (await (await request.post(path, withPhoto())).json()).incidentId,
  ).toBe(receipt.incidentId);
  expect(
    (
      await request.post(path, withPhoto({ ...data, commandId: randomUUID() }))
    ).status(),
  ).toBe(409);
  const evidenceUrl = `${origin}/api/incidents/products/${receipt.incidentId}/evidence`;
  expect((await request.get(evidenceUrl)).status()).toBe(401);
  console.log(
    `Product write HTTP latency: ${Math.round(performance.now() - started)} ms (including replay/conflict)`,
  );
  expect(
    (
      await page.request.post(`${origin}/api/session`, {
        headers: { Origin: origin },
        data: { login, password },
      })
    ).status(),
  ).toBe(200);
  const classification = `${origin}/api/incidents/products/${receipt.incidentId}/classification`;
  expect(
    (
      await page.request.patch(classification, {
        headers: { Origin: "https://foreign.invalid" },
        data: { expectedVersion: 1, department: "Compras", concept: "Picking" },
      })
    ).status(),
  ).toBe(403);
  await page.setViewportSize({ width: 1500, height: 800 });
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Incidencias en vivo", exact: true })
    .click();
  const live = page.getByRole("region", {
    name: "Incidencias de ruta",
    exact: true,
  });
  await expect(live).toContainText("Producto 1");
  await expect(live).toContainText("Chofer 0");
  await expect(
    live
      .getByRole("button", { name: "Marcar resuelto", exact: true })
      .locator("svg"),
  ).toHaveCSS("color", "rgb(39, 219, 133)");
  await expect(
    live.getByRole("img", { name: /Evidencia de Cliente 1/ }),
  ).toHaveCount(3);
  for (let index = 1; index <= 3; index++) {
    await expect(
      live.getByRole("img", { name: `Evidencia de Cliente 1 · ${index}` }),
    ).toBeVisible();
    const imageUrl = await live
      .getByRole("link", { name: new RegExp(`Ver foto ${index}`) })
      .getAttribute("href");
    expect((await request.get(origin + imageUrl!)).status()).toBe(401);
    expect((await page.request.get(origin + imageUrl!)).status()).toBe(200);
  }
  const evidence = await page.request.get(evidenceUrl);
  expect(evidence.status()).toBe(200);
  expect(evidence.headers()["content-type"]).toBe("image/webp");
  expect(evidence.headers()["cache-control"]).toContain("private");
  expect((await sharp(await evidence.body()).metadata()).format).toBe("webp");
  await expect
    .poll(
      async () =>
        (
          await f.db.pool.query(
            "SELECT archived_at IS NOT NULL AS archived FROM route_plans WHERE id=$1",
            [f.planId],
          )
        ).rows[0].archived,
      {
        timeout: 20_000,
        message:
          "Startup worker catches up the weekly archive without deleting live product evidence",
      },
    )
    .toBe(true);
  await expect(live).toContainText("Producto 1");
  expect((await page.request.get(evidenceUrl)).status()).toBe(200);
  await page
    .getByLabel("Chofer", { exact: true })
    .selectOption(f.members[1].driverId);
  await expect(live).toContainText("Sin incidencias en este apartado");
  await page
    .getByLabel("Chofer", { exact: true })
    .selectOption(f.members[0].driverId);
  await expect(live).toContainText("Producto 1");
  await page.getByRole("button", { name: "Incidencias", exact: true }).click();
  const history = page.getByRole("region", {
    name: "Incidencias por producto",
    exact: true,
  });
  await expect(history).toContainText("Reportó: Chofer 0");
  await expect(
    history.getByRole("button", { name: "Resolver", exact: true }),
  ).toHaveCount(0);
  await expect(history).toContainText("Comentarios / evidencia");
  await expect(history.locator(".product-incident-note")).toHaveCSS(
    "white-space",
    "pre-wrap",
  );
  await history.getByRole("button", { name: "Editar clasificación" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar clasificación" });
  await dialog.getByLabel("Departamento", { exact: true }).fill("Compras");
  await dialog.getByLabel("Concepto", { exact: true }).fill("Especiales");
  await dialog.getByRole("button", { name: "Guardar clasificación" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(history).toContainText("Especiales");
  expect(
    (
      await page.request.patch(classification, {
        headers: { Origin: origin },
        data: {
          expectedVersion: 1,
          department: "Operaciones",
          concept: "Reparto",
        },
      })
    ).status(),
  ).toBe(409);
  const url = await history
    .getByRole("link", { name: "Exportar Excel" })
    .getAttribute("href");
  const download = await page.request.get(origin + url!);
  expect(download.status()).toBe(200);
  expect(download.headers()["cache-control"]).toContain("private");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await download.body()) as never);
  const sheet = workbook.getWorksheet("Incidencias")!;
  expect(sheet.columnCount).toBe(9);
  expect(sheet.getCell("F2").value).toBe("Compras");
  expect(sheet.getCell("D2").value).toBe(0.25);
  expect(sheet.getCell("H2").value).toBe(
    "No cumple con las especificaciones del cliente\nSe modificó la cantidad en la orden\nProducto dañado",
  );
  expect(JSON.stringify(sheet.model)).not.toContain("Chofer 0");
  expect(JSON.stringify(sheet.model)).not.toContain("Especiales");
  await mkdir(".local/qa/product-incidents", { recursive: true });
  await page.screenshot({
    path: ".local/qa/product-incidents/history.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/qa/product-incidents/mobile-panel.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1500, height: 800 });
  await page
    .getByRole("button", { name: "Incidencias en vivo", exact: true })
    .click();
  await live
    .getByRole("button", { name: "Marcar resuelto", exact: true })
    .click();
  const resolve = page.getByRole("dialog", { name: "Resolver incidencia" });
  await resolve
    .getByLabel("Cómo se resolvió")
    .fill("Reposición confirmada por administración");
  await resolve.getByRole("button", { name: "Confirmar resolución" }).click();
  await expect(live).toContainText("Sin incidencias en este apartado");
  const rows = (
    await f.db.pool.query(
      "SELECT status,department,concept,quantity::text,snapshot FROM route_product_incidents WHERE id=$1",
      [receipt.incidentId],
    )
  ).rows;
  expect(rows).toMatchObject([
    {
      status: "resolved",
      department: "Compras",
      concept: "Especiales",
      quantity: "0.250000",
      snapshot: { reportedDepartment: "Ventas", reportedConcept: "Picking" },
    },
  ]);
  expect(
    (
      await f.db.pool.query(
        "SELECT action FROM route_audit WHERE entity_id=$1 ORDER BY id",
        [receipt.incidentId],
      )
    ).rows.map((row) => row.action),
  ).toEqual(["product_incident.classified", "product_incident.resolved"]);
  const latest = await readDriverExecution(
    f.db.pool,
    f.members[0].driverId,
    f.planId,
    f.timezone,
  );
  const identity = (route: typeof latest) => ({
    commandId: randomUUID(),
    executionId: route.id,
    publicationRevision: route.publicationRevision,
    executionRevision: route.revision,
    stopVersion: route.stops[0].version,
    visitSequence: route.stops[0].visitSequence,
    orderVersion: route.stops[0].orderStates[0].version,
  });
  const shortage = {
    ...identity(latest),
    kind: "shortage_warehouse",
    product: "Limón sin semilla",
    unit: "kg",
    quantity: "3",
    warehouseReason: "special",
    department: "Compras",
    concept: "Especiales",
    formVersion: 2,
    comments: [],
    note: "Faltó en bodega",
  };
  const missing = await request.post(path, { headers, data: shortage });
  expect(missing.status()).toBe(201);
  const missingId = (await missing.json()).incidentId;
  await page.getByRole("button", { name: "Incidencias", exact: true }).click();
  await expect(history).toContainText("Limón sin semilla");
  const changePath = `${path}/${missingId}`;
  const next = await readDriverExecution(
    f.db.pool,
    f.members[0].driverId,
    f.planId,
    f.timezone,
  );
  const amend = {
    ...shortage,
    ...identity(next),
    expectedVersion: 1,
    quantity: "2",
    note: "Cliente confirmó dos",
  };
  expect(
    (await request.post(`${changePath}/amend`, { data: amend })).status(),
  ).toBe(401);
  expect(
    (
      await request.post(`${changePath}/amend`, {
        headers: { Authorization: f.members[1].authorization },
        data: amend,
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(`${changePath}/amend`, { headers, data: amend })
    ).status(),
  ).toBe(200);
  expect(
    (
      await (
        await request.post(`${changePath}/amend`, { headers, data: amend })
      ).json()
    ).duplicate,
  ).toBe(true);
  const edited = await readDriverExecution(
    f.db.pool,
    f.members[0].driverId,
    f.planId,
    f.timezone,
  );
  expect(
    edited.stops[0].productIncidents.find(
      (incident) => incident.id === missingId,
    ),
  ).toMatchObject({ quantity: "2.000000", version: 2 });
  const cancel = { ...identity(edited), expectedVersion: 2 };
  expect(
    (
      await request.post(`${changePath}/cancel`, { headers, data: cancel })
    ).status(),
  ).toBe(200);
  expect(
    (
      await (
        await request.post(`${changePath}/cancel`, { headers, data: cancel })
      ).json()
    ).duplicate,
  ).toBe(true);
  expect(
    (
      await readDriverExecution(
        f.db.pool,
        f.members[0].driverId,
        f.planId,
        f.timezone,
      )
    ).stops[0].productIncidents.find((incident) => incident.id === missingId)
      ?.status,
  ).toBe("canceled");
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*) FROM route_product_incident_changes WHERE incident_id=$1",
        [missingId],
      )
    ).rows[0].count,
  ).toBe("2");
  await expect(history).not.toContainText("Limón sin semilla", {
    timeout: 20_000,
  });
  await expect(history).toContainText("Producto 1");
  const visibleReport = await page.request.get(
    `${origin}/api/incidents/products`,
  );
  expect(
    (await visibleReport.json()).rows.map((row: { id: string }) => row.id),
  ).toEqual([receipt.incidentId]);
  await page.screenshot({
    path: ".local/qa/product-incidents/canceled-hidden.png",
    fullPage: true,
  });
  const afterCancel = await page.request.get(origin + url!);
  const afterCancelBook = new ExcelJS.Workbook();
  await afterCancelBook.xlsx.load((await afterCancel.body()) as never);
  expect(afterCancelBook.getWorksheet("Incidencias")!.rowCount).toBe(2);
  const beforeClose = await readDriverExecution(
    f.db.pool,
    f.members[0].driverId,
    f.planId,
    f.timezone,
  );
  await executeDriverOrderCommand(
    f.db.pool,
    headers.Authorization,
    f.planId,
    beforeClose.stops[0].id,
    beforeClose.stops[0].shipmentIds[0],
    {
      ...identity(beforeClose),
      kind: "deliver",
      productIncidentsAcknowledged: true,
    },
    f.timezone,
  );
  const closed = await readDriverExecution(
    f.db.pool,
    f.members[0].driverId,
    f.planId,
    f.timezone,
  );
  const incidentVersion = closed.stops[0].productIncidents.find(
    (incident) => incident.id === receipt.incidentId,
  )!.version;
  const removalUrl = `${origin}/api/incidents/products/${receipt.incidentId}`;
  expect(
    (
      await request.delete(removalUrl, {
        data: { expectedVersion: incidentVersion },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await page.request.delete(removalUrl, {
        headers: { Origin: "https://foreign.invalid" },
        data: { expectedVersion: incidentVersion },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.delete(removalUrl, {
        headers: { Origin: origin },
        data: { expectedVersion: incidentVersion - 1 },
      })
    ).status(),
  ).toBe(409);
  const trash = history.getByRole("button", {
    name: /Eliminar incidencia de Producto 1/,
  });
  await expect(trash).toHaveCSS("background-color", "rgb(180, 35, 46)");
  await trash.click();
  const removal = page.getByRole("dialog", {
    name: "Eliminar incidencia de producto",
    exact: true,
  });
  await expect(removal).toContainText("Si ya está cerrado");
  await expect(
    removal.getByRole("button", { name: "Conservar incidencia" }),
  ).toBeFocused();
  await expect(removal).toHaveCSS("border-radius", "12px");
  await expect(removal).toHaveCSS("background-color", "rgb(16, 24, 19)");
  await expect(removal).toHaveCSS("border-top-color", "rgb(59, 75, 64)");
  await expect(removal.locator(".toolbar")).toHaveCSS("display", "flex");
  await expect(removal.locator(".toolbar")).toHaveCSS("gap", "10px");
  await page.screenshot({
    path: ".local/qa/product-incidents/delete-dialog-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await removal.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: ".local/qa/product-incidents/delete-dialog-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1500, height: 800 });
  await page.keyboard.press("Escape");
  await expect(removal).toHaveCount(0);
  await expect(trash).toBeFocused();
  await trash.click();
  await removal.getByRole("button", { name: "Conservar incidencia" }).click();
  await expect(history).toContainText("Producto 1");
  await trash.click();
  await removal
    .getByRole("button", { name: "Eliminar incidencia", exact: true })
    .click();
  await expect(removal).toHaveCount(0);
  await expect(history).toContainText("Sin incidencias de producto");
  const adminReplay = await page.request.delete(removalUrl, {
    headers: { Origin: origin },
    data: { expectedVersion: incidentVersion },
  });
  expect(adminReplay.status()).toBe(200);
  expect((await adminReplay.json()).duplicate).toBe(true);
  const afterRemoval = await readDriverExecution(
    f.db.pool,
    f.members[0].driverId,
    f.planId,
    f.timezone,
  );
  expect(afterRemoval.revision).toBe(closed.revision);
  expect(afterRemoval.stops[0].orderStates).toEqual(
    closed.stops[0].orderStates,
  );
  expect(
    afterRemoval.stops[0].productIncidents.find(
      (incident) => incident.id === receipt.incidentId,
    ),
  ).toMatchObject({
    status: "resolved",
    quantity: "0.250000",
    reportRemoved: true,
  });
  const removedBook = new ExcelJS.Workbook();
  await removedBook.xlsx.load(
    (await (await page.request.get(origin + url!)).body()) as never,
  );
  expect(removedBook.getWorksheet("Incidencias")!.rowCount).toBe(1);
  expect((await page.request.get(evidenceUrl)).status()).toBe(200);
  await page.screenshot({
    path: ".local/qa/product-incidents/admin-removed.png",
    fullPage: true,
  });
  expect(pageErrors).toEqual([]);
});

test("admin removes pending and resolved product reports after route cancellation without changing historical orders", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const ids: string[] = [];
  const photo = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#779f32" },
  })
    .jpeg()
    .toBuffer();
  for (let index = 0; index < 2; index++) {
    const route = await readDriverExecution(
        f.db.pool,
        f.members[0].driverId,
        f.planId,
        f.timezone,
      ),
      stop = route.stops[0];
    const receipt = await reportProductIncidentWithEvidence(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stop.id,
      stop.shipmentIds[0],
      {
        commandId: randomUUID(),
        executionId: route.id,
        publicationRevision: route.publicationRevision,
        executionRevision: route.revision,
        stopVersion: stop.version,
        visitSequence: stop.visitSequence,
        orderVersion: stop.orderStates[0].version,
        kind: "replacement_quality",
        department: "Operaciones",
        lineIndex: 0,
        quantity: "0.5",
      },
      f.timezone,
      photo,
      "image/jpeg",
      f.photoRoot,
    );
    ids.push(receipt.incidentId!);
  }
  await resolveProductIncident(f.db.pool, f.actor, ids[1], {
    expectedVersion: 1,
    note: "Reposición atendida",
  });
  const route = await readDriverExecution(
    f.db.pool,
    f.members[0].driverId,
    f.planId,
    f.timezone,
  );
  const plan = (
    await f.db.pool.query("SELECT version FROM route_plans WHERE id=$1", [
      f.planId,
    ])
  ).rows[0];
  await cancelPublishedRoute(
    f.db.pool,
    f.actor,
    f.planId,
    f.members[0].vehicleId,
    {
      expectedVersion: plan.version,
      expectedRevision: route.publicationRevision,
    },
  );
  const before = (
    await f.db.pool.query(
      "SELECT * FROM route_driver_execution_orders WHERE execution_id=$1 ORDER BY shipment_id",
      [route.id],
    )
  ).rows;
  expect(
    (
      await page.request.post(`${origin}/api/session`, {
        headers: { Origin: origin },
        data: { login, password },
      })
    ).status(),
  ).toBe(200);
  await page.goto(origin);
  await page.getByRole("button", { name: "Incidencias", exact: true }).click();
  const history = page.getByRole("region", {
    name: "Incidencias por producto",
    exact: true,
  });
  await expect(
    history.getByRole("button", { name: /Eliminar incidencia de Producto 1/ }),
  ).toHaveCount(2);
  for (let index = 0; index < 2; index++) {
    await history
      .getByRole("button", { name: /Eliminar incidencia de Producto 1/ })
      .first()
      .click();
    const removal = page.getByRole("dialog", {
      name: "Eliminar incidencia de producto",
      exact: true,
    });
    await expect(removal).toContainText("la ruta fue cancelada");
    const responsePromise = page.waitForResponse(
      (r) =>
        r.request().method() === "DELETE" &&
        r.url().includes("/api/incidents/products/"),
    );
    await removal
      .getByRole("button", { name: "Eliminar incidencia", exact: true })
      .click();
    expect((await responsePromise).status()).toBe(200);
    await expect(
      history.getByRole("button", {
        name: /Eliminar incidencia de Producto 1/,
      }),
    ).toHaveCount(1 - index);
  }
  await expect(history).toContainText("Sin incidencias de producto");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    (await (
      await page.request.get(`${origin}/api/incidents/products/export`)
    ).body()) as never,
  );
  expect(book.getWorksheet("Incidencias")!.rowCount).toBe(1);
  expect(
    (
      await f.db.pool.query(
        "SELECT * FROM route_driver_execution_orders WHERE execution_id=$1 ORDER BY shipment_id",
        [route.id],
      )
    ).rows,
  ).toEqual(before);
  for (const [index, id] of ids.entries()) {
    expect(
      (
        await f.db.pool.query(
          "SELECT status,quantity::text,report_removed_at IS NOT NULL AS removed FROM route_product_incidents WHERE id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({
      status: index === 0 ? "pending" : "resolved",
      quantity: "0.500000",
      removed: true,
    });
    expect(
      (
        await page.request.get(
          `${origin}/api/incidents/products/${id}/evidence`,
        )
      ).status(),
    ).toBe(200);
  }
});
