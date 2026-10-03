import { test, expect, type Browser } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { bootstrap, createUser } from "../../src/core/auth";
import { createPlan } from "../../src/core/plans";
import { saveDeparture } from "../../src/core/departure";
import { createVehicle } from "../../src/core/fleet";
import { updateCustomer } from "../../src/core/customers";
import {
  orderBoard,
  persistImportPage,
  selectPlanVehicles,
  moveShipment,
} from "../../src/core/orders";
import { readFulfilledByOrderNames } from "../../src/core/odoo";
import { saveRoutingSettings } from "../../src/core/routing-settings";
import {
  applyOptimizationResult,
  getPlanOptimization,
} from "../../src/core/route-optimization";
import { routeTimeConflicts } from "../../src/core/route-time-conflicts";
import type { OrderBoard } from "../../src/core/orders-contract";
import type { GoogleOptimizationResult } from "../../src/core/route-optimization-google";
import type { RoutingSettings } from "../../src/core/routing-contract";
import { startPostgres, freePort } from "../helpers/postgres";

// Explicit real-case replay: actual Odoo reads, a saved receipt of the Google call
// made for this block, actual persistence and HTTP/Chrome. No intercepted APIs,
// fabricated routes or additional Fleet calls. Remote Odoo and plans stay read-only.
async function verifyRealReceipt(
  browser: Browser,
  receiptKind: "new" | "deadline",
) {
  const directory = process.env.RUTAS_QA_ZONE_TIME_CAPTURE_DIRECTORY;
  test.skip(
    !directory,
    "Requires a verified real Google receipt and private development Odoo configuration",
  );
  test.setTimeout(300000);
  const captured: {
    board: OrderBoard;
    settings: RoutingSettings;
    timezone: string;
  } = JSON.parse(await readFile(`${directory}/input-projection.json`, "utf8"));
  const receipt: GoogleOptimizationResult = JSON.parse(
    await readFile(`${directory}/${receiptKind}-result.json`, "utf8"),
  );
  const imported = await readFulfilledByOrderNames(
    captured.board.shipments.map((s) => s.orderName),
  );
  expect(imported.shipments.map((s) => s.orderName).sort()).toEqual(
    captured.board.shipments.map((s) => s.orderName).sort(),
  );
  const db = await startPostgres();
  let server: ChildProcess | undefined;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const login = randomUUID(),
    password = randomUUID();
  try {
    const actor = (
      await bootstrap(db.pool, db.config, {
        token: db.config.bootstrapToken,
        login,
        password,
        name: "QA copia real",
      })
    ).id;
    let plan = await createPlan(db.pool, actor, {
      date: captured.board.plan.service_date,
      label: "QA copia real",
    });
    const departure = captured.board.plan.departure_minute!;
    plan = await saveDeparture(db.pool, actor, plan.id, {
      departureTime: `${String(Math.floor(departure / 60)).padStart(2, "0")}:${String(departure % 60).padStart(2, "0")}`,
      expectedVersion: plan.version,
    });
    const settings = await saveRoutingSettings(db.pool, actor, {
      depotAddress: captured.settings.depotAddress,
      depotLocation: captured.settings.depotLocation,
      expectedVersion: 0,
    });
    for (const vehicle of captured.board.vehicles)
      await createVehicle(db.pool, actor, {
        id: vehicle.id,
        name: vehicle.name,
        brand: "QA",
        model: "QA",
        plate: randomUUID().slice(0, 8),
        mileage: 0,
        fuel: "Gasolina",
        available: true,
      });
    await selectPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds: captured.board.vehicles.map((v) => v.id),
      expectedVersion: plan.version,
    });
    await persistImportPage(db.pool, actor, plan.id, imported);
    const customers = (
      await db.pool.query(
        "SELECT id,version,odoo_partner_id FROM route_customers ORDER BY odoo_partner_id",
      )
    ).rows;
    for (const customer of customers) {
      const observed = captured.board.shipments.find(
        (s) => s.partnerId === Number(customer.odoo_partner_id),
      )!;
      expect(observed).toBeDefined();
      const clock = (minute: number) => ({
        hour: Math.floor(minute / 60),
        minute: minute % 60,
      });
      await updateCustomer(db.pool, actor, customer.id, {
        displayName: observed.customerName,
        phone: null,
        deliveryNote: "",
        fulfillmentMode: "delivery",
        deliveryAddress: imported.shipments.find(
          (s) => s.partnerId === observed.partnerId,
        )!.address,
        mapUrl: null,
        priority: observed.priority,
        unloadingMinutes: observed.unloadingMinutes,
        windows: observed.deliveryWindows.map((w) => ({
          start: clock(w.startMinute),
          end: clock(w.endMinute),
        })),
        location: {
          latitude: observed.latitude,
          longitude: observed.longitude,
          placeId: null,
        },
        expectedVersion: Number(customer.version),
      });
    }
    let before = await orderBoard(db.pool, plan.id);
    for (const observed of captured.board.shipments) {
      const shipment = before.shipments.find(
        (s) => s.orderName === observed.orderName,
      )!;
      expect(shipment.partnerId).toBe(observed.partnerId);
      expect(shipment).toMatchObject({
        latitude: observed.latitude,
        longitude: observed.longitude,
        priority: observed.priority,
        unloadingMinutes: observed.unloadingMinutes,
        deliveryWindows: observed.deliveryWindows,
      });
    }
    await db.pool.query(
      `UPDATE route_shipments s SET position=o.position
       FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id,position)
       WHERE s.plan_id=$2 AND s.id=o.id`,
      [
        captured.board.shipments.map(
          (observed) =>
            before.shipments.find((s) => s.orderName === observed.orderName)!
              .id,
        ),
        plan.id,
      ],
    );
    before = await orderBoard(db.pool, plan.id);
    const mapped: GoogleOptimizationResult = {
      ...receipt,
      routes: receipt.routes.map((route) => ({
        ...route,
        vehicleIndex: before.vehicles.findIndex(
          (v) => v.id === captured.board.vehicles[route.vehicleIndex].id,
        ),
        visits: route.visits.map((visit) => ({
          ...visit,
          shipmentIndex: before.shipments.findIndex(
            (s) =>
              s.orderName ===
              captured.board.shipments[visit.shipmentIndex].orderName,
          ),
        })),
      })),
    };
    expect(
      mapped.routes.every(
        (r) =>
          r.vehicleIndex >= 0 && r.visits.every((v) => v.shipmentIndex >= 0),
      ),
    ).toBe(true);
    const run = await applyOptimizationResult(
      db.pool,
      actor,
      plan.id,
      before.plan.version,
      settings.version,
      before,
      before.shipments,
      createHash("sha256")
        .update(
          await readFile(`${directory}/${receiptKind}-google-request.json`),
        )
        .digest("hex"),
      mapped,
      { chosenSource: "Google" },
    );
    expect(run?.routes.every((r) => r.calculationSource === "google")).toBe(
      true,
    );
    const current = await orderBoard(db.pool, plan.id);
    const conflicts = routeTimeConflicts(current, run);
    const expectedLate = receipt.routes
      .flatMap((r) => r.visits)
      .filter((v) => (v.lateSeconds ?? 0) > 0).length;
    expect(conflicts).toHaveLength(expectedLate);
    if (receiptKind === "deadline") expect(conflicts).toHaveLength(0);
    expect(run?.routes.flatMap((r) => r.stops)).toHaveLength(
      before.shipments.length,
    );
    expect((await getPlanOptimization(db.pool, plan.id))?.routes).toEqual(
      run?.routes,
    );
    const port = await freePort(),
      origin = `http://127.0.0.1:${port}`;
    const noExternal = Object.fromEntries(
      Object.keys(process.env)
        .filter((k) => k.startsWith("ODOO_") || k.startsWith("RUTAS_GOOGLE_"))
        .map((k) => [k, ""]),
    );
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
          ...noExternal,
          RUTAS_DATABASE_URL: db.config.databaseUrl,
          RUTAS_INSTANCE_ID: db.config.instanceId,
          RUTAS_BOOTSTRAP_TOKEN: db.config.bootstrapToken,
          RUTAS_APP_ORIGIN: origin,
          RUTAS_TIMEZONE: captured.timezone,
        },
      },
    );
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`${origin}/api/ready`)).status;
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(200);
    expect(
      (
        await context.request.post(`${origin}/api/session`, {
          headers: { Origin: origin },
          data: { login, password },
        })
      ).status(),
    ).toBe(200);
    const endpoint = `${origin}/api/plans/${plan.id}/optimization`;
    expect(
      (
        await context.request.post(endpoint, {
          headers: { Origin: "https://foreign.example" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    const restricted = await browser.newContext();
    expect((await restricted.request.get(endpoint)).status()).toBe(401);
    const restrictedLogin = randomUUID(),
      restrictedPassword = randomUUID();
    await createUser(db.pool, actor, {
      name: "QA rol restringido",
      login: restrictedLogin,
      password: restrictedPassword,
      role: "settlement",
    });
    expect(
      (
        await restricted.request.post(`${origin}/api/session`, {
          headers: { Origin: origin },
          data: { login: restrictedLogin, password: restrictedPassword },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await restricted.request.post(endpoint, {
          headers: { Origin: origin },
          data: {},
        })
      ).status(),
    ).toBe(403);
    await restricted.close();
    const page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Planificar rutas", exact: true })
      .click();
    await page.getByLabel("Abrir borrador").selectOption(plan.id);
    await page
      .getByRole("button", { name: "Ver mapa de rutas", exact: true })
      .click();
    // An absent warning is meaningful only after the saved forecast has loaded.
    await expect(
      page.getByText("Recorrido vigente · regreso incluido", { exact: false }),
    ).toBeVisible();
    const warning = page.locator(
      'details[aria-label="Pedidos fuera de horario previstos"]',
    );
    if (conflicts.length) {
      await expect(warning).toBeVisible();
      await warning.locator("summary").click();
      await expect(warning).toHaveAttribute("open", "");
      await expect(warning).toHaveCSS("position", "static");
      await expect(warning).toHaveCSS("pointer-events", "auto");
      for (const conflict of conflicts)
        await expect(warning).toContainText(conflict.orderName);
    } else await expect(warning).toBeHidden();
    await mkdir("reports/screenshots", { recursive: true });
    await page.screenshot({
      path: `reports/screenshots/zone-time-${receiptKind}-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (conflicts.length)
      expect(
        await warning.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.left >= 0 &&
            bounds.right <= window.innerWidth &&
            element.scrollWidth <= element.clientWidth
          );
        }),
      ).toBe(true);
    await page.screenshot({
      path: `reports/screenshots/zone-time-${receiptKind}-mobile.png`,
      fullPage: true,
    });
    await page
      .getByRole("dialog")
      .getByRole("combobox")
      .selectOption(current.vehicles[0].id);
    const filtered = routeTimeConflicts(current, run, current.vehicles[0].id);
    if (filtered.length)
      await expect(warning.locator("li")).toHaveCount(filtered.length);
    else await expect(warning).toBeHidden();
    await page.getByRole("dialog").getByRole("combobox").selectOption("all");
    const changedShipment = conflicts.length
      ? current.shipments.find((s) => s.id === conflicts[0].shipmentId)!
      : current.shipments[0];
    await moveShipment(db.pool, actor, plan.id, {
      shipmentId: changedShipment.id,
      vehicleId: null,
      expectedVersion: current.plan.version,
    });
    await expect(warning).toBeHidden({ timeout: 20000 });
    expect((await getPlanOptimization(db.pool, plan.id))?.current).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    if (server && server.exitCode === null)
      await new Promise<void>((done) => {
        server!.once("exit", () => done());
        server!.kill();
      });
    await db.close();
  }
}

test("real Google reference receipt reaches PostgreSQL and forecast warnings", async ({
  browser,
}) => {
  await verifyRealReceipt(browser, "new");
});
test("real Google deadline receipt preserves all orders without forecast warnings", async ({
  browser,
}) => {
  await verifyRealReceipt(browser, "deadline");
});
