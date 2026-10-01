import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { beforeAll, afterAll, expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { financialObservation } from "./helpers/financial";
import { buildFinancialSnapshot } from "../src/core/financial-policy";
import { persistFinancialSnapshot } from "../src/core/financial-store";
import { transaction, migrate } from "../src/core/database";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import { executeDriverOrderCommand } from "../src/core/driver-order-command";
import { confirmOrderPayment } from "../src/core/payments";
import { reportProductIncidentWithEvidence } from "../src/core/product-incidents-evidence";
import { readFinanceEvidence } from "../src/core/finance-evidence";
import { createUser } from "../src/core/auth";
import {
  readMobileFinanceDetail,
  listMobileFinance,
} from "../src/core/finance-read";
let f: Awaited<ReturnType<typeof executionFixture>>,
  executionId: string,
  shipmentId: string;
const detail = () =>
  readMobileFinanceDetail(f.db.pool, f.members[0].authorization, executionId);
const command = async (patch: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  shipmentId,
  basis: (await detail()).orders.find((o) => o.shipmentId === shipmentId)!
    .basis,
  method: "cash",
  tendered: "15",
  change: "0",
  note: "Quedan 5",
  ...patch,
});
const confirm = (raw: Record<string, unknown>, authorization?: string) =>
  confirmOrderPayment(
    f.db.pool,
    authorization ?? f.members[0].authorization,
    executionId,
    raw,
    f.timezone,
  );
beforeAll(async () => {
  f = await executionFixture();
  await f.start();
  // Reconstruct the actual pre-finance boundary in isolated PostgreSQL, with a started route and existing users.
  await f.db.pool
    .query(`DROP TABLE route_settlement_claims,route_settlement_items,route_settlement_requests,route_order_payments,route_finance_execution_orders;
    DROP TRIGGER preserve_account_role ON route_users; ALTER TABLE route_users DROP COLUMN role;
    UPDATE rutas_installation SET schema_version=35;`);
  await migrate(f.db.pool, f.db.config.instanceId);
  await migrate(f.db.pool, f.db.config.instanceId);
  expect(
    (
      await f.db.pool.query("SELECT role FROM route_users WHERE id=$1", [
        f.actor,
      ])
    ).rows[0].role,
  ).toBe("routes");
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM route_finance_execution_orders",
      )
    ).rows[0].n,
  ).toBeGreaterThan(0);
  let r = await readDriverExecution(
    f.db.pool,
    f.members[0].driverId,
    f.planId,
    f.timezone,
  );
  executionId = r.id;
  const s = (
    await f.db.pool.query("SELECT * FROM route_shipments WHERE picking_id=1")
  ).rows[0];
  shipmentId = s.id;
  const observation = financialObservation();
  observation.moves[0].id = 1;
  observation.moves[0].productId = 1;
  observation.saleLines[0].productId = 1;
  await transaction(f.db.pool, (sql) =>
    persistFinancialSnapshot(
      sql,
      buildFinancialSnapshot(
        { source: s.source, pickingId: 1, orderId: 1, partnerId: 1 },
        observation,
      ),
      60,
      1,
    ),
  );
  const stop = r.stops.find((s) => s.shipmentIds.includes(shipmentId))!;
  await executeStopCommand(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stop.id,
    "arrival",
    {
      commandId: randomUUID(),
      executionId: r.id,
      publicationRevision: r.publicationRevision,
      executionRevision: r.revision,
      stopVersion: stop.version,
      visitSequence: stop.visitSequence,
      policyVersion: r.policy.version,
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
  r = await readDriverExecution(
    f.db.pool,
    f.members[0].driverId,
    f.planId,
    f.timezone,
  );
  let arrived = r.stops.find((s) => s.id === stop.id)!;
  await reportProductIncidentWithEvidence(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stop.id,
    shipmentId,
    {
      commandId: randomUUID(),
      executionId: r.id,
      publicationRevision: r.publicationRevision,
      executionRevision: r.revision,
      stopVersion: arrived.version,
      visitSequence: arrived.visitSequence,
      orderVersion: arrived.orderStates[0].version,
      kind: "replacement_quality",
      department: "Operaciones",
      concept: "Picking",
      comments: [],
      formVersion: 2,
      financialContractVersion: 1,
      financial: { revision: 1, moveId: 1, saleLineId: 10 },
      lineIndex: 0,
      quantity: "1",
      replacementPayment: "pay_full",
    },
    f.timezone,
    await sharp({
      create: { width: 24, height: 24, channels: 3, background: "#334455" },
    })
      .jpeg()
      .toBuffer(),
    "image/jpeg",
    f.photoRoot,
  );
  r = await readDriverExecution(
    f.db.pool,
    f.members[0].driverId,
    f.planId,
    f.timezone,
  );
  arrived = r.stops.find((s) => s.id === stop.id)!;
  await executeDriverOrderCommand(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stop.id,
    shipmentId,
    {
      commandId: randomUUID(),
      executionId: r.id,
      publicationRevision: r.publicationRevision,
      executionRevision: r.revision,
      stopVersion: arrived.version,
      visitSequence: arrived.visitSequence,
      orderVersion: arrived.orderStates.find(
        (o) => o.shipmentId === shipmentId,
      )!.version,
      kind: "deliver",
      productIncidentsAcknowledged: true,
    },
    f.timezone,
    f.now,
  );
}, 120000);
afterAll(async () => {
  await f?.close();
});
it("authorizes own historical finance only and refuses stale/changed financial confirmation", async () => {
  await expect(
    readMobileFinanceDetail(
      f.db.pool,
      f.members[0].authorization,
      randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    confirm(await command({ shipmentId: randomUUID() })),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(
    (await listMobileFinance(f.db.pool, f.members[0].authorization)).map(
      (r) => r.id,
    ),
  ).toContain(executionId);
  await expect(
    readMobileFinanceDetail(f.db.pool, f.members[1].authorization, executionId),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    confirm(await command(), f.members[1].authorization),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    confirm(await command({ basis: "x".repeat(64) })),
  ).rejects.toMatchObject({ code: "PAYMENT_BASIS_CHANGED" });
  await f.db.pool.query(
    "UPDATE route_financial_targets SET last_error='ODOO_DOWN'",
  );
  await expect(confirm(await command())).rejects.toMatchObject({
    code: "FINANCIAL_SOURCE_STALE",
  });
  await f.db.pool.query(
    "UPDATE route_financial_targets SET last_error=NULL,last_success_at=now()",
  );
  const undelivered = (await detail()).orders.find(
    (o) => o.status !== "delivered",
  )!;
  await expect(
    confirm(
      await command({
        shipmentId: undelivered.shipmentId,
        basis: undelivered.basis,
      }),
    ),
  ).rejects.toMatchObject({ code: "PAYMENT_DELIVERY_REQUIRED" });
});
it("serializes payment confirmation and recovers the identical receipt without duplicate money", async () => {
  const raw = await command();
  const results = await Promise.all([confirm(raw), confirm(raw)]);
  expect(results[0].id).toBe(results[1].id);
  expect(results.filter((r) => r.duplicate)).toHaveLength(1);
  await expect(confirm({ ...raw, tendered: "14" })).rejects.toMatchObject({
    code: "COMMAND_REUSED",
  });
  await expect(confirm(await command())).rejects.toMatchObject({
    code: "PAYMENT_ALREADY_CONFIRMED",
  });
  const result = await detail(),
    order = result.orders.find((o) => o.shipmentId === shipmentId)!;
  expect(order.payment).toMatchObject({
    received: "15",
    expected: "20",
    balance: "5",
    note: "Quedan 5",
  });
  expect(result.totals[0]).toMatchObject({
    cash: "15",
    credit: "0",
    transfer: "0",
    balance: "5",
  });
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM route_order_payments",
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(
    f.db.pool.query("UPDATE route_order_payments SET received=16"),
  ).rejects.toBeTruthy();
  await expect(
    f.db.pool.query("DELETE FROM route_order_payments"),
  ).rejects.toBeTruthy();
  await expect(
    f.db.pool.query("UPDATE route_order_payments SET note='Altered receipt'"),
  ).rejects.toBeTruthy();
  for (const amount of ["NaN", "Infinity", "-Infinity", "-1"]) {
    await expect(
      f.db.pool.query(
        `INSERT INTO route_order_payments SELECT (jsonb_populate_record(NULL::route_order_payments,
      to_jsonb(p)||jsonb_build_object('id',$1::text,'command_id',$2::text,'expected',$3::text))).* FROM route_order_payments p LIMIT 1`,
        [randomUUID(), randomUUID(), amount],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      message: "PAYMENT_AMOUNT_INVALID",
    });
  }
  for (const amount of ["NaN", "Infinity", "-Infinity", "-1", "0.001"])
    await expect(
      f.db.pool.query(
        `INSERT INTO route_order_payments SELECT (jsonb_populate_record(NULL::route_order_payments,
      to_jsonb(p)||jsonb_build_object('id',$1::text,'command_id',$2::text,'cash_received',$3::text))).* FROM route_order_payments p LIMIT 1`,
        [randomUUID(), randomUUID(), amount],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      message: "PAYMENT_COMPONENT_INVALID",
    });
  await expect(
    f.db.pool.query(
      `INSERT INTO route_order_payments SELECT (jsonb_populate_record(NULL::route_order_payments,
      to_jsonb(p)||jsonb_build_object('id',$1::text,'command_id',$2::text,'capture_version',2))).* FROM route_order_payments p LIMIT 1`,
      [randomUUID(), randomUUID()],
    ),
  ).rejects.toMatchObject({
    code: "23514",
    constraint: "payment_full_capture",
  });
  await migrate(f.db.pool, f.db.config.instanceId);
  expect(
    (await detail()).orders.find((o) => o.shipmentId === shipmentId)!.payment!
      .received,
  ).toBe("15");
});
it("retains original receipts and restricts real evidence after financial source changes", async () => {
  const original = (await detail()).orders.find(
    (o) => o.shipmentId === shipmentId,
  )!;
  const incident = original.payment!.snapshot.incidents[0];
  const receiver = await createUser(f.db.pool, f.actor, {
    name: "Evidence receiver",
    login: "evidence-receiver",
    password: randomUUID(),
    role: "settlement",
  });
  const receiverPhoto = await readFinanceEvidence(
    f.db.pool,
    { actor: receiver.id },
    executionId,
    incident.id,
    incident.evidence_id,
    f.photoRoot,
  );
  expect((await sharp(receiverPhoto).metadata()).format).toBe("webp");
  expect(incident.replacement_payment).toBe("pay_full");
  const photo = await readFinanceEvidence(
    f.db.pool,
    { authorization: f.members[0].authorization },
    executionId,
    incident.id,
    incident.evidence_id,
    f.photoRoot,
  );
  expect((await sharp(photo).metadata()).format).toBe("webp");
  await expect(
    readFinanceEvidence(
      f.db.pool,
      { authorization: f.members[1].authorization },
      executionId,
      incident.id,
      incident.evidence_id,
      f.photoRoot,
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    readFinanceEvidence(
      f.db.pool,
      { actor: f.actor },
      executionId,
      incident.id,
      incident.evidence_id,
      f.photoRoot,
    ),
  ).rejects.toMatchObject({ code: "ROLE_DENIED" });
  await expect(
    readFinanceEvidence(
      f.db.pool,
      { authorization: f.members[0].authorization },
      executionId,
      incident.id,
      randomUUID(),
      f.photoRoot,
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const row = (
    await f.db.pool.query("SELECT source FROM route_shipments WHERE id=$1", [
      shipmentId,
    ])
  ).rows[0];
  const observation = financialObservation();
  observation.moves[0].id = 1;
  observation.moves[0].productId = 1;
  observation.saleLines[0].productId = 1;
  observation.saleLines[0].unitPrice = "15";
  observation.saleLines[0].amounts = { untaxed: "30", tax: "0", total: "30" };
  observation.order.amounts = { untaxed: "30", tax: "0", total: "30" };
  await transaction(f.db.pool, (sql) =>
    persistFinancialSnapshot(
      sql,
      buildFinancialSnapshot(
        { source: row.source, pickingId: 1, orderId: 1, partnerId: 1 },
        observation,
      ),
      60,
      1,
    ),
  );
  const changed = (await detail()).orders.find(
    (o) => o.shipmentId === shipmentId,
  )!;
  expect(changed.changedAfterPayment).toBe(true);
  expect(changed.payment).toEqual(original.payment);
  expect(changed.payment!.snapshot.financial!.totals!.net).toBe("20");
});
