import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { executionFixture } from "../helpers/driver-execution";
import { freePort } from "../helpers/postgres";
import { financialObservation } from "../helpers/financial";
import { buildFinancialSnapshot } from "../../src/core/financial-policy";
import { persistFinancialSnapshot } from "../../src/core/financial-store";
import { transaction } from "../../src/core/database";
import { readDriverExecution } from "../../src/core/driver-execution-read";
import { executeStopCommand } from "../../src/core/driver-stop-command";

test("authorized mobile HTTP reads prices, records a linked shortage and replays it without duplicate deduction", async ({
  request,
}) => {
  test.setTimeout(120000);
  const f = await executionFixture();
  let server: ChildProcess | undefined;
  try {
    await f.start();
    const row = (
      await f.db.pool.query("SELECT * FROM route_shipments WHERE picking_id=1")
    ).rows[0];
    const observation = financialObservation();
    observation.moves[0].id = 1;
    observation.moves[0].productId = 1;
    observation.saleLines[0].productId = 1;
    const snapshot = buildFinancialSnapshot(
      { source: row.source, pickingId: 1, orderId: 1, partnerId: 1 },
      observation,
    );
    await transaction(f.db.pool, (sql) =>
      persistFinancialSnapshot(sql, snapshot, 60, 1),
    );
    const state = await readDriverExecution(
      f.db.pool,
      f.members[0].driverId,
      f.planId,
      f.timezone,
    );
    const stop = state.stops.find((s) => s.shipmentIds.includes(row.id))!;
    await executeStopCommand(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stop.id,
      "arrival",
      {
        commandId: randomUUID(),
        executionId: state.id,
        publicationRevision: state.publicationRevision,
        executionRevision: state.revision,
        stopVersion: stop.version,
        policyVersion: state.policy.version,
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
        { timeout: 30000 },
      )
      .toBe(200);
    const headers = { Authorization: f.members[0].authorization };
    const path = `${origin}/api/mobile/plans/${f.planId}`;
    expect((await request.get(path)).status()).toBe(401);
    const detail = await (await request.get(path, { headers })).json();
    expect(
      detail.orders.find((o: { id: string }) => o.id === row.id).financial,
    ).toMatchObject({
      status: "ready",
      totals: { net: "20" },
      lines: [{ unitPrice: "10", quantity: "2" }],
    });
    const current = await (
      await request.get(`${path}/execution`, { headers })
    ).json();
    const active = current.stops.find((s: { id: string }) => s.id === stop.id);
    const data = {
      commandId: randomUUID(),
      executionId: current.id,
      publicationRevision: current.publicationRevision,
      executionRevision: current.revision,
      stopVersion: active.version,
      visitSequence: active.visitSequence,
      orderVersion: active.orderStates.find(
        (o: { shipmentId: string }) => o.shipmentId === row.id,
      ).version,
      kind: "shortage_validation",
      department: "Operaciones",
      concept: "Picking",
      comments: [],
      formVersion: 2,
      financialContractVersion: 1,
      financial: { revision: 1, moveId: 1, saleLineId: 10 },
      lineIndex: 0,
      quantity: "0.125",
    };
    const commandPath = `${path}/stops/${stop.id}/orders/${row.id}/product-incidents`;
    expect(
      (
        await request.post(commandPath, {
          headers: { Authorization: f.members[1].authorization },
          data,
        })
      ).status(),
    ).toBe(404);
    const first = await request.post(commandPath, { headers, data });
    expect(first.status()).toBe(201);
    const receipt = await first.json();
    const replay = await (
      await request.post(commandPath, { headers, data })
    ).json();
    expect(replay).toMatchObject({
      incidentId: receipt.incidentId,
      duplicate: true,
    });
    const after = await (await request.get(path, { headers })).json();
    expect(
      after.orders.find((o: { id: string }) => o.id === row.id).financial
        .totals,
    ).toMatchObject({ original: "20", deduction: "1.25", net: "18.75" });
  } finally {
    if (server && server.exitCode === null)
      await new Promise<void>((resolve) => {
        server!.once("exit", () => resolve());
        server!.kill();
      });
    await f.close();
  }
});
