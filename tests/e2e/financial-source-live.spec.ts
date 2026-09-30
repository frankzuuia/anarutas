import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { startPostgres, freePort } from "../helpers/postgres";
import { bootstrap } from "../../src/core/auth";
import { createPlan } from "../../src/core/plans";
import { createVehicle } from "../../src/core/fleet";
import { readShipmentFinancials } from "../../src/core/financial-store";
import type { CandidateBatch } from "../../src/core/order-candidates-contract";

test("real HTTP import activates the financial worker without a manual sync command", async ({
  request,
}) => {
  test.skip(
    !process.env.ODOO_URL ||
      !process.env.RUTAS_QA_ORDER_DATE ||
      !process.env.RUTAS_TEST_FINANCIAL_TARGETS,
    "Requires an explicitly configured real read-only Odoo source and selected identities",
  );
  test.setTimeout(180_000);
  const db = await startPostgres();
  let child: ChildProcess | undefined;
  try {
    const login = randomUUID(),
      password = randomUUID();
    const actor = (
      await bootstrap(db.pool, db.config, {
        token: db.config.bootstrapToken,
        name: "Financial HTTP QA",
        login,
        password,
      })
    ).id;
    const date = process.env.RUTAS_QA_ORDER_DATE!;
    const plan = await createPlan(db.pool, actor, {
      date,
      label: "Financial automatic QA",
    });
    const vehicle = await createVehicle(db.pool, actor, {
      id: randomUUID(),
      name: "QA",
      brand: "QA",
      model: "QA",
      plate: randomUUID().slice(0, 8),
      mileage: 0,
      fuel: "Gasolina",
      available: true,
    });
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
        cwd: process.cwd(),
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          RUTAS_APP_ORIGIN: origin,
          RUTAS_DATABASE_URL: db.config.databaseUrl,
          RUTAS_INSTANCE_ID: db.config.instanceId,
          RUTAS_TIMEZONE: "America/Mexico_City",
          RUTAS_FINANCIAL_POLL_SECONDS: "5",
          RUTAS_GOOGLE_FINOPS_SERVICE_ACCOUNT_JSON_BASE64: "",
          RUTAS_GOOGLE_ROUTES_API_KEY: "",
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
        { timeout: 30000 },
      )
      .toBe(200);
    const headers = { Origin: origin };
    const query = {
      date,
      vehicleIds: [vehicle.id],
      expectedVersion: plan.version,
    };
    const url = `${origin}/api/plans/${plan.id}/orders`;
    expect(
      (
        await request.post(`${url}/candidates`, { headers, data: query })
      ).status(),
    ).toBe(401);
    expect(
      (
        await request.post(`${origin}/api/session`, {
          headers,
          data: { login, password },
        })
      ).status(),
    ).toBe(200);
    const queried = await request.post(`${url}/candidates`, {
      headers,
      data: query,
    });
    expect(queried.status()).toBe(200);
    const batch = (await queried.json()) as CandidateBatch;
    const wanted: { pickingId: number; orderId: number }[] = JSON.parse(
      process.env.RUTAS_TEST_FINANCIAL_TARGETS!,
    );
    const selected = batch.candidates.filter((candidate) =>
      wanted.some(
        (target) =>
          target.pickingId === candidate.shipment.pickingId &&
          target.orderId === candidate.shipment.orderId,
      ),
    );
    expect(selected).toHaveLength(wanted.length);
    expect(
      selected.every((candidate) =>
        candidate.shipment.lines.every((line) => line.saleLineId && line.uomId),
      ),
    ).toBe(true);
    const command = {
      batchId: batch.batchId,
      expectedVersion: batch.expectedVersion,
      vehicleIds: [vehicle.id],
      selection: {
        mode: "explicit",
        ids: selected.map((candidate) => candidate.candidateId),
      },
    };
    expect(
      (
        await request.post(`${url}/confirm`, {
          headers: { Origin: "https://untrusted.invalid" },
          data: command,
        })
      ).status(),
    ).toBe(403);
    const confirmed = await request.post(`${url}/confirm`, {
      headers,
      data: command,
    });
    expect(confirmed.status()).toBe(200);
    const receipt = await confirmed.json();
    expect(receipt.inserted).toBe(selected.length);
    expect(
      await (
        await request.post(`${url}/confirm`, { headers, data: command })
      ).json(),
    ).toEqual(receipt);
    const operational = (
      await db.pool.query("SELECT id,snapshot FROM route_shipments ORDER BY id")
    ).rows;
    // No call to syncFinancialSources: instrumentation must discover and process the queue itself.
    await expect
      .poll(
        async () =>
          (
            await db.pool.query(
              "SELECT count(*)::int AS count FROM route_financial_targets WHERE revision>0",
            )
          ).rows[0].count,
        { timeout: 75000, intervals: [1000] },
      )
      .toBe(selected.length);
    for (const row of operational) {
      const financial = await readShipmentFinancials(db.pool, actor, row.id);
      expect(financial.snapshot?.target.orderId).toBe(row.snapshot.orderId);
      expect(financial.snapshot?.lines.length).toBe(row.snapshot.lines.length);
      expect(financial.last_error).toBeNull();
    }
    expect(
      (
        await db.pool.query(
          "SELECT id,snapshot FROM route_shipments ORDER BY id",
        )
      ).rows,
    ).toEqual(operational);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM route_financial_targets",
        )
      ).rows[0].count,
    ).toBe(selected.length);
  } finally {
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
