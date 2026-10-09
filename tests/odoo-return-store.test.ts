import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { paymentExecutionFixture } from "./helpers/payment-execution";
import { readOdooConfig } from "../src/core/config";
import {
  captureOdooReturn,
  enqueueOdooReturn,
} from "../src/core/odoo-return-store";
import { reportProductIncidentWithEvidence } from "../src/core/product-incidents-evidence";
import { readMobileFinanceDetail } from "../src/core/finance-read";
import { confirmOrderPayment } from "../src/core/payments";
import { migrate, transaction } from "../src/core/database";
import { readIncidentBoard } from "../src/core/incident-board";
import type { ReturnRequest } from "../src/core/odoo-return-policy";
import { changeProductIncident } from "../src/core/product-incidents";

it("real PostgreSQL: atomic attention/payment/outbox, replay, fresh captures, immutable receipt, admin visibility and isolation", async () => {
  const settings = {
    ODOO_URL: "https://return-domain-qa.invalid",
    ODOO_DATABASE: "return-domain-qa",
    ODOO_USERNAME: "qa",
    ODOO_API_KEY: randomUUID(),
    ODOO_COMPANY_ID: "1",
    RUTAS_ODOO_RETURNS_ENABLED: "true",
  };
  const old = Object.fromEntries(
    Object.keys(settings).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, settings);
  const config = readOdooConfig();
  let f: Awaited<ReturnType<typeof paymentExecutionFixture>> | undefined;
  try {
    f = await paymentExecutionFixture({
      collectAtFirstStop: true,
      orderCount: 1,
      now: new Date(),
      sourceFingerprint: config.fingerprint,
      sourceLineMetadata: { uomId: 3, saleLineId: 10 },
    });
    const { pool } = f.db;
    const before = (
      await pool.query("SELECT schema_version FROM rutas_installation")
    ).rows[0].schema_version;
    await Promise.all([
      migrate(pool, f.db.config.instanceId),
      migrate(pool, f.db.config.instanceId),
    ]);
    expect(before).toBe(48);
    const shipmentId = f.shipmentRows[0].id;
    const identity = async () => {
      const route = await f!.state(),
        stop = route.stops[0];
      return {
        commandId: randomUUID(),
        executionId: route.id,
        publicationRevision: route.publicationRevision,
        executionRevision: route.revision,
        stopVersion: stop.version,
        visitSequence: stop.visitSequence,
        orderVersion: stop.orderStates[0].version,
      };
    };
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#229933" },
    })
      .jpeg()
      .toBuffer();
    const raw = {
      ...(await identity()),
      kind: "return",
      formVersion: 3,
      lineIndex: 0,
      quantity: "0.1",
      comments: ["damaged_product"],
      financialContractVersion: 1,
      financial: { revision: 1, moveId: 1, saleLineId: 10 },
    };
    await expect(
      reportProductIncidentWithEvidence(
        pool,
        f.members[1].authorization,
        f.planId,
        (await f.state()).stops[0].id,
        shipmentId,
        raw,
        f.timezone,
        bytes,
        "image/jpeg",
        f.photoRoot,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const report = async () =>
      reportProductIncidentWithEvidence(
        pool,
        f!.members[0].authorization,
        f!.planId,
        (await f!.state()).stops[0].id,
        shipmentId,
        { ...raw, ...(await identity()) },
        f!.timezone,
        bytes,
        "image/jpeg",
        f!.photoRoot,
      );
    process.env.RUTAS_ODOO_RETURNS_ENABLED = "false";
    const historical = await report();
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM route_odoo_return_capture",
        )
      ).rows[0].n,
    ).toBe(0);
    process.env.RUTAS_ODOO_RETURNS_ENABLED = "true";
    const incident = await report();
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM route_odoo_return_capture",
        )
      ).rows[0].n,
    ).toBe(1);
    await changeProductIncident(
      pool,
      f.members[0].authorization,
      f.planId,
      (await f.state()).stops[0].id,
      shipmentId,
      incident.incidentId!,
      { ...raw, ...(await identity()), expectedVersion: 1, quantity: "0.25" },
      "amend",
    );
    const additional = await report();
    const canceled = await report();
    await changeProductIncident(
      pool,
      f.members[0].authorization,
      f.planId,
      (await f.state()).stops[0].id,
      shipmentId,
      canceled.incidentId!,
      { ...(await identity()), expectedVersion: 1 },
      "cancel",
    );
    expect(
      (await pool.query("SELECT count(*)::int n FROM route_odoo_return_jobs"))
        .rows[0].n,
    ).toBe(0);
    const detail = await readMobileFinanceDetail(
        pool,
        f.members[0].authorization,
        f.executionId,
      ),
      order = detail.orders[0];
    const payment = {
      commandId: randomUUID(),
      shipmentId,
      method: "cash",
      tendered: "15.5",
      change: "0",
      note: "",
      basis: order.basis,
      captureVersion: 2,
      attention: {
        ...(await identity()),
        planId: f.planId,
        stopId: (await f.state()).stops[0].id,
        productIncidentsAcknowledged: true,
      },
    };
    await expect(
      confirmOrderPayment(
        pool,
        f.members[0].authorization,
        f.executionId,
        { ...payment, basis: "0".repeat(64) },
        f.timezone,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_BASIS_CHANGED" });
    expect(
      (await pool.query("SELECT count(*)::int n FROM route_odoo_return_jobs"))
        .rows[0].n,
    ).toBe(0);
    const paid = await confirmOrderPayment(
      pool,
      f.members[0].authorization,
      f.executionId,
      payment,
      f.timezone,
    );
    const replay = await confirmOrderPayment(
      pool,
      f.members[0].authorization,
      f.executionId,
      payment,
      f.timezone,
    );
    expect(replay).toMatchObject({ id: paid.id, duplicate: true });
    await transaction(pool, (sql) => enqueueOdooReturn(sql, paid.id));
    const jobs = (await pool.query("SELECT * FROM route_odoo_return_jobs"))
      .rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("queued");
    expect((jobs[0].request as ReturnRequest).lines).toEqual([
      {
        moveId: 1,
        productId: 1,
        uomId: 3,
        quantity: "0.35",
        incidentIds: expect.arrayContaining([
          incident.incidentId,
          additional.incidentId,
        ]),
      },
    ]);
    expect(
      (await pool.query("SELECT incident_id FROM route_odoo_return_incidents"))
        .rows,
    ).toEqual(
      expect.arrayContaining([
        { incident_id: incident.incidentId },
        { incident_id: additional.incidentId },
      ]),
    );
    await expect(
      pool.query(
        "INSERT INTO route_odoo_return_incidents(incident_id,job_id) VALUES($1,$2)",
        [historical.incidentId, jobs[0].id],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      pool.query(
        "INSERT INTO route_odoo_return_incidents(incident_id,job_id) VALUES($1,$2)",
        [canceled.incidentId, jobs[0].id],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    const wrongId = randomUUID();
    await expect(
      pool.query(
        `INSERT INTO route_odoo_return_jobs(id,execution_id,shipment_id,payment_id,source,picking_id,order_id,request)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          wrongId,
          jobs[0].execution_id,
          shipmentId,
          paid.id,
          "another-source",
          jobs[0].picking_id,
          jobs[0].order_id,
          JSON.stringify({
            ...jobs[0].request,
            id: wrongId,
            source: "another-source",
          }),
        ],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    const board = await readIncidentBoard(
      pool,
      f.actor,
      new URLSearchParams(),
      f.timezone,
    );
    expect(
      board.rows.find((row) => row.id === incident.incidentId)?.odooReturn
        ?.status,
    ).toBe("queued");
    await expect(
      pool.query("UPDATE route_odoo_return_jobs SET request='{}'"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      pool.query("DELETE FROM route_odoo_return_jobs"),
    ).rejects.toBeTruthy();
    await expect(
      pool.query("UPDATE route_order_payments SET expected=999"),
    ).rejects.toBeTruthy();
    await pool.query(
      "UPDATE route_odoo_return_jobs SET creation_started=true,remote_id=99",
    );
    await expect(
      pool.query(
        "UPDATE route_odoo_return_jobs SET creation_started=false,remote_id=NULL",
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      pool.query("UPDATE route_odoo_return_jobs SET remote_id=98"),
    ).rejects.toMatchObject({ code: "42501" });
    await transaction(pool, async (sql) => {
      await captureOdooReturn(sql, incident.incidentId!, false);
      await enqueueOdooReturn(sql, paid.id, false);
    });
    expect(
      (await pool.query("SELECT count(*)::int n FROM route_odoo_return_jobs"))
        .rows[0].n,
    ).toBe(1);
  } finally {
    await f?.close();
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}, 120000);
