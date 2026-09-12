import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { bootstrap } from "../../src/core/auth";
import { createPlan } from "../../src/core/plans";
import { saveDeparture } from "../../src/core/departure";
import { createVehicle } from "../../src/core/fleet";
import { updateCustomer } from "../../src/core/customers";
import {
  orderBoard,
  persistImportPage,
  selectPlanVehicles,
} from "../../src/core/orders";
import { readFulfilledByOrderNames } from "../../src/core/odoo";
import { saveRoutingSettings } from "../../src/core/routing-settings";
import {
  assertDeliveryGroups,
  deliveryGroups,
} from "../../src/core/route-delivery-groups";
import { startPostgres, freePort } from "../helpers/postgres";

// Opt-in replay of a real case. The caller supplies points/preferences read from
// Ana Rutas; orders are reread in Odoo and every provider call is real. No external
// writes: only the disposable loopback PostgreSQL installation is changed.
test("real customer-group planning through browser, OpenAI, Google and isolated PostgreSQL", async ({
  browser,
}) => {
  test.skip(
    !process.env.RUTAS_QA_ROUTING_CASE,
    "Requires an explicit real routing case and private development provider credentials",
  );
  test.setTimeout(600000);
  const scenario = JSON.parse(process.env.RUTAS_QA_ROUTING_CASE!);
  const db = await startPostgres();
  let child: ChildProcess | undefined;
  const login = randomUUID(),
    password = randomUUID();
  const context = await browser.newContext();
  try {
    const actor = (
      await bootstrap(db.pool, db.config, {
        token: db.config.bootstrapToken,
        login,
        password,
        name: "QA grupos reales",
      })
    ).id;
    let plan = await createPlan(db.pool, actor, {
      date: scenario.date,
      label: "QA copia de ruta real",
    });
    plan = await saveDeparture(db.pool, actor, plan.id, {
      departureTime: scenario.departureTime,
      expectedVersion: plan.version,
    });
    await saveRoutingSettings(db.pool, actor, {
      ...scenario.depot,
      expectedVersion: 0,
    });
    const vehicleIds: string[] = [];
    for (let index = 0; index < scenario.vehicleCount; index++) {
      const vehicle = await createVehicle(db.pool, actor, {
        id: randomUUID(),
        name: `QA ${index + 1}`,
        brand: "QA",
        model: "QA",
        plate: randomUUID().slice(0, 8),
        mileage: 0,
        fuel: "Gasolina",
        available: true,
      });
      vehicleIds.push(vehicle.id);
    }
    await selectPlanVehicles(db.pool, actor, plan.id, {
      vehicleIds,
      expectedVersion: plan.version,
    });
    const imported = await readFulfilledByOrderNames(scenario.orderNames);
    await persistImportPage(db.pool, actor, plan.id, imported);
    const customers = (
      await db.pool.query(
        "SELECT id,version,odoo_partner_id FROM route_customers ORDER BY odoo_partner_id",
      )
    ).rows;
    for (const customer of customers) {
      const preference = scenario.customers.find(
        (item: { partnerId: number }) =>
          item.partnerId === Number(customer.odoo_partner_id),
      );
      expect(
        preference,
        "Every real customer needs explicitly observed preferences and point",
      ).toBeDefined();
      const order = imported.shipments.find(
        (s) => s.partnerId === Number(customer.odoo_partner_id),
      )!;
      await updateCustomer(db.pool, actor, customer.id, {
        displayName: order.customerName,
        phone: null,
        deliveryNote: "",
        fulfillmentMode: "delivery",
        deliveryAddress: order.address,
        mapUrl: null,
        priority: preference.priority,
        windows: preference.windows,
        location: preference.location,
        expectedVersion: Number(customer.version),
      });
    }
    const before = await orderBoard(db.pool, plan.id);
    expect(
      deliveryGroups(before.shipments).some((g) => g.shipmentIds.length > 1),
    ).toBe(true);
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
          RUTAS_TIMEZONE: scenario.timezone,
          RUTAS_GOOGLE_FINOPS_SERVICE_ACCOUNT_JSON_BASE64: "",
        },
      },
    );
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(origin + "/api/ready")).status;
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBe(200);
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
    const startedAt = Date.now();
    const completed = page.waitForResponse(
      (r) =>
        r.url().endsWith("/optimization") && r.request().method() === "POST",
      { timeout: 540000 },
    );
    await page
      .getByRole("button", {
        name: "Armar ruta con OpenAI y Google",
        exact: true,
      })
      .click();
    const response = await completed;
    const result = await response.json();
    expect(response.status(), JSON.stringify(result)).toBe(200);
    await page
      .getByRole("button", { name: "Cerrar mapa", exact: true })
      .click();
    const after = await orderBoard(db.pool, plan.id);
    expect(after.plan.version).toBe(before.plan.version + 1);
    expect(after.shipments.map((s) => s.id).sort()).toEqual(
      before.shipments.map((s) => s.id).sort(),
    );
    const assignments = after.vehicles.map((v) => ({
      vehicleId: v.id,
      shipmentIds: after.shipments
        .filter((s) => s.vehicle_id === v.id)
        .map((s) => s.id),
    }));
    assertDeliveryGroups(after.shipments, assignments);
    expect(after.shipments.every((s) => s.vehicle_id !== null)).toBe(true);
    for (const group of deliveryGroups(after.shipments)) {
      const members = after.shipments.filter((s) =>
        group.shipmentIds.includes(s.id),
      );
      expect(new Set(members.map((s) => s.vehicle_id)).size).toBe(1);
      const vehicle = after.vehicles.find(
        (v) => v.id === members[0].vehicle_id,
      )!;
      const lane = page.getByRole("region", {
        name: `Pedidos de ${vehicle.name}`,
        exact: true,
      });
      for (const member of members)
        await expect(
          lane.getByRole("button", {
            name: `Mostrar detalles de ${member.customerName} ${member.orderName}`,
            exact: true,
          }),
        ).toBeVisible();
    }
    const audit = (
      await db.pool.query(
        "SELECT details FROM route_audit WHERE action='plan.optimized' AND entity_id=$1",
        [plan.id],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].details.deliveryGroups).toBe(customers.length);
    console.log(
      JSON.stringify({
        liveRouting: "PASS",
        durationMs: Date.now() - startedAt,
        groups: customers.length,
        shipments: after.shipments.length,
        toolCalls: audit[0].details.toolCalls,
        evaluatedCandidates: audit[0].details.evaluatedCandidates,
        routes: after.vehicles.map((v) => ({
          orders: after.shipments
            .filter((s) => s.vehicle_id === v.id)
            .map((s) => s.orderName),
        })),
      }),
    );
  } finally {
    await context.close();
    if (child && child.exitCode === null)
      await new Promise<void>((done) => {
        child!.once("exit", () => done());
        child!.kill();
      });
    await db.close();
  }
});
