import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { beforeAll, afterAll, expect, it } from "vitest";
import { paymentExecutionFixture } from "./helpers/payment-execution";
import {
  readMobileFinanceDetail,
  readSettlementDetail,
  listSettlements,
} from "../src/core/finance-read";
import { confirmOrderPayment } from "../src/core/payments";
import { requestSettlement, decideSettlement } from "../src/core/settlements";
import { reportProductIncidentWithEvidence } from "../src/core/product-incidents-evidence";
import { createUser } from "../src/core/auth";
import { driverPublicationFingerprint } from "../src/core/driver-mobile-events";
import { migrate } from "../src/core/database";

let f: Awaited<ReturnType<typeof paymentExecutionFixture>>, receiver: string;
let acceptedCommand: Record<string, unknown>, paymentId: string;
const detail = () =>
  readMobileFinanceDetail(f.db.pool, f.members[0].authorization, f.executionId);
const attention = async () => {
  const route = await f.state(),
    stop = route.stops[0];
  return {
    planId: f.planId,
    stopId: stop.id,
    publicationRevision: route.publicationRevision,
    executionRevision: route.revision,
    stopVersion: stop.version,
    visitSequence: stop.visitSequence,
    orderVersion: stop.orderStates[0].version,
    productIncidentsAcknowledged: true,
  };
};
const command = async (patch: Record<string, unknown> = {}) => {
  const order = (await detail()).orders.find(
    (o) => o.shipmentId === f.shipmentRows[0].id,
  )!;
  return {
    commandId: randomUUID(),
    shipmentId: order.shipmentId,
    basis: order.basis,
    captureVersion: 2,
    method: "cash",
    tendered: order.financial!.totals!.net,
    change: "0",
    note: "Cobro confirmado por cliente",
    attention: await attention(),
    ...patch,
  };
};
const confirm = (
  raw: Record<string, unknown>,
  authorization = f.members[0].authorization,
) =>
  confirmOrderPayment(f.db.pool, authorization, f.executionId, raw, f.timezone);
beforeAll(async () => {
  f = await paymentExecutionFixture({ collectAtFirstStop: true });
  receiver = (
    await createUser(f.db.pool, f.actor, {
      name: "Recepción por cliente",
      login: "collection-receiver",
      password: randomUUID(),
      role: "settlement",
    })
  ).id;
}, 120000);
afterAll(async () => {
  await f?.close();
});

it("opening and canceling collection only reads; stale visit, foreign devices and wrong amounts never close an order", async () => {
  const initial = await f.state(),
    input = await command();
  expect(initial.stops[0].orderStates[0]).toMatchObject({
    status: "open",
    paymentRequired: true,
    paymentConfirmed: false,
  });
  expect((await detail()).orders[0].payment).toBeNull();
  expect(
    (await readSettlementDetail(f.db.pool, receiver, f.executionId)).orders,
  ).toEqual([]);
  await expect(
    confirm(input, f.members[1].authorization),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    confirm({ ...input, commandId: randomUUID(), basis: "0".repeat(64) }),
  ).rejects.toMatchObject({ code: "PAYMENT_BASIS_CHANGED" });
  await expect(
    confirm({ ...input, commandId: randomUUID(), tendered: "15" }),
  ).rejects.toMatchObject({ code: "PAYMENT_FULL_AMOUNT_REQUIRED" });
  for (const patch of [
    { executionRevision: initial.revision + 1 },
    { stopVersion: initial.stops[0].version + 1 },
    { orderVersion: 99 },
    { visitSequence: 99 },
    {
      stopId: initial.stops[1].id,
      stopVersion: initial.stops[1].version,
      visitSequence: initial.stops[1].visitSequence,
    },
  ])
    await expect(
      confirm({
        ...input,
        commandId: randomUUID(),
        attention: { ...input.attention, ...patch },
      }),
    ).rejects.toBeTruthy();
  await expect(
    confirm({
      ...input,
      commandId: randomUUID(),
      attention: [],
      captureVersion: 2,
    }),
  ).rejects.toMatchObject({ code: "PAYMENT_ATTENTION_INVALID" });
  await expect(
    confirm({
      ...input,
      commandId: randomUUID(),
      attention: input.attention,
      captureVersion: undefined,
    }),
  ).rejects.toMatchObject({ code: "PAYMENT_ATTENTION_INVALID" });
  expect(await f.state()).toMatchObject({
    id: initial.id,
    revision: initial.revision,
    stops: initial.stops,
  });
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM route_order_payments",
      )
    ).rows[0].n,
  ).toBe(0);
});

it("subtracts a real product return and requires explicit incident acknowledgement before collection", async () => {
  const input = await command(),
    route = await f.state(),
    stop = route.stops[0];
  await reportProductIncidentWithEvidence(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stop.id,
    f.shipmentRows[0].id,
    {
      commandId: randomUUID(),
      executionId: route.id,
      ...input.attention,
      kind: "return",
      department: "Operaciones",
      concept: "Picking",
      comments: [],
      formVersion: 2,
      financialContractVersion: 1,
      financial: {
        revision: 1,
        moveId: Number(f.shipmentRows[0].picking_id),
        saleLineId: 10,
      },
      lineIndex: 0,
      quantity: "1",
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
  const order = (await detail()).orders[0];
  expect(order.financial!.totals).toMatchObject({
    original: "20",
    deduction: "10",
    net: "10",
  });
  await expect(
    confirm({
      ...(await command()),
      attention: {
        ...(await attention()),
        productIncidentsAcknowledged: false,
      },
    }),
  ).rejects.toMatchObject({ code: "PRODUCT_INCIDENTS_ACK_REQUIRED" });
  expect((await f.state()).stops[0].orderStates[0].status).toBe("open");
});

it("rolls back delivery, versions and events if receipt persistence fails inside PostgreSQL", async () => {
  const input = await command(),
    before = await f.state();
  // Real database fault injection, contained in this isolated test database.
  await f.db.pool.query(
    "ALTER TABLE route_order_payments ADD CONSTRAINT qa_collection_write_failure CHECK (false) NOT VALID",
  );
  try {
    await expect(confirm(input)).rejects.toMatchObject({ code: "23514" });
  } finally {
    await f.db.pool.query(
      "ALTER TABLE route_order_payments DROP CONSTRAINT qa_collection_write_failure",
    );
  }
  expect(await f.state()).toMatchObject({
    id: before.id,
    revision: before.revision,
    stops: before.stops,
  });
  expect((await detail()).orders[0].payment).toBeNull();
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM route_driver_stop_events WHERE kind='delivery'",
      )
    ).rows[0].n,
  ).toBe(0);
});

it("accept commits delivery and split receipt once, freezes the resulting basis and appears live in the exclusive receiver account", async () => {
  const fingerprint = await driverPublicationFingerprint(
    f.db.pool,
    f.members[0].driverId,
  );
  acceptedCommand = await command({
    method: "mixed",
    cashReceived: "4",
    transferReceived: "6",
  });
  const raced = await Promise.all([
    confirm(acceptedCommand),
    confirm(acceptedCommand),
  ]);
  expect(raced[0].id).toBe(raced[1].id);
  expect(raced.map((r) => r.duplicate).sort()).toEqual([false, true]);
  paymentId = raced[0].id;
  const order = (await detail()).orders[0];
  expect((await f.state()).stops[0].orderStates[0]).toMatchObject({
    status: "delivered",
    paymentRequired: true,
    paymentConfirmed: true,
  });
  expect(order.changedAfterPayment).toBe(false);
  expect(order.payment).toMatchObject({
    method: "mixed",
    captureVersion: 2,
    expected: "10",
    received: "10",
    cashReceived: "4",
    transferReceived: "6",
    balance: "0",
    change: "0",
  });
  expect(order.payment!.snapshot.financial!.totals).toMatchObject({
    original: "20",
    deduction: "10",
    net: "10",
  });
  expect(order.payment!.snapshot.status).toBe("delivered");
  const receiverDetail = await readSettlementDetail(
    f.db.pool,
    receiver,
    f.executionId,
  );
  expect(receiverDetail.route.completedAt).toBeNull();
  expect(receiverDetail.orders.map((o) => o.payment!.id)).toEqual([paymentId]);
  expect(receiverDetail.requests).toEqual([]);
  expect(
    await driverPublicationFingerprint(f.db.pool, f.members[0].driverId),
  ).not.toBe(fingerprint);
  await expect(
    readSettlementDetail(f.db.pool, f.actor, f.executionId),
  ).rejects.toMatchObject({ code: "ROLE_DENIED" });
  const report = await listSettlements(
    f.db.pool,
    receiver,
    new URLSearchParams({ from: "2026-09-24", to: "2026-09-24" }),
    f.timezone,
  );
  expect(report.rows).toHaveLength(1);
  expect(report.metrics.find((m) => m.stage === "collected")).toMatchObject({
    cash: "4",
    transfer: "6",
    credit: "0",
  });
});

it("liquidates this paid client before route completion and prevents duplicate or altered collection/reception", async () => {
  await expect(
    confirm({ ...acceptedCommand, note: "Alteración" }),
  ).rejects.toMatchObject({ code: "COMMAND_REUSED" });
  await expect(
    confirm(await command({ attention: undefined })),
  ).rejects.toMatchObject({ code: "PAYMENT_ALREADY_CONFIRMED" });
  await expect(
    requestSettlement(f.db.pool, f.members[1].authorization, f.executionId, {
      commandId: randomUUID(),
      shipmentId: f.shipmentRows[0].id,
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const requested = await requestSettlement(
    f.db.pool,
    f.members[0].authorization,
    f.executionId,
    { commandId: randomUUID(), shipmentId: f.shipmentRows[0].id },
  );
  const receiverDetail = await readSettlementDetail(
      f.db.pool,
      receiver,
      f.executionId,
    ),
    req = receiverDetail.requests.find((r) => r.id === requested.id)!;
  expect(req.paymentIds).toEqual([paymentId]);
  expect(req.totals[0]).toMatchObject({
    cash: "4",
    transfer: "6",
    credit: "0",
  });
  const decision = {
    commandId: randomUUID(),
    version: req.version,
    basis: req.basis,
    note: "Recibido por cliente",
    decision: "accepted",
  };
  const received = await Promise.all([
    decideSettlement(f.db.pool, receiver, req.id, decision),
    decideSettlement(f.db.pool, receiver, req.id, decision),
  ]);
  expect(received.map((r) => r.duplicate).sort()).toEqual([false, true]);
  expect(
    (await readSettlementDetail(f.db.pool, receiver, f.executionId))
      .acceptedTotals[0],
  ).toMatchObject({ cash: "4", transfer: "6" });
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM route_settlement_claims WHERE payment_id=$1",
        [paymentId],
      )
    ).rows[0].n,
  ).toBe(1);
});

it("repeated migration preserves version-two components, forbids SQL tampering and keeps response-loss replay valid", async () => {
  await migrate(f.db.pool, f.db.config.instanceId);
  await migrate(f.db.pool, f.db.config.instanceId);
  expect((await detail()).orders[0].payment).toMatchObject({
    captureVersion: 2,
    cashReceived: "4",
    transferReceived: "6",
  });
  await expect(
    f.db.pool.query(
      "UPDATE route_order_payments SET cash_received=0 WHERE id=$1",
      [paymentId],
    ),
  ).rejects.toBeTruthy();
  expect(await confirm(acceptedCommand)).toMatchObject({
    id: paymentId,
    duplicate: true,
  });
});
