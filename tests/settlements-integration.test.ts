import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { paymentExecutionFixture } from "./helpers/payment-execution";
import {
  createUser,
  login,
  authenticate,
  setUserActive,
} from "../src/core/auth";
import { assertActiveActor, migrate } from "../src/core/database";
import {
  readMobileFinanceDetail,
  readSettlementDetail,
  listSettlements,
} from "../src/core/finance-read";
import { confirmOrderPayment } from "../src/core/payments";
import { requestSettlement, decideSettlement } from "../src/core/settlements";
import { driverPublicationFingerprint } from "../src/core/driver-mobile-events";
let f: Awaited<ReturnType<typeof paymentExecutionFixture>>,
  receiver: string,
  receiver2: string;
const mobile = () =>
  readMobileFinanceDetail(f.db.pool, f.members[0].authorization, f.executionId);
const request = (shipmentId: string | null, commandId = randomUUID()) =>
  requestSettlement(f.db.pool, f.members[0].authorization, f.executionId, {
    commandId,
    shipmentId,
  });
const decision = async (
  id: string,
  decision = "accepted",
  actor = receiver,
  commandId = randomUUID(),
) => {
  const req = (await mobile()).requests.find((r) => r.id === id)!;
  return decideSettlement(f.db.pool, actor, id, {
    commandId,
    version: 1,
    basis: req.basis,
    note: "Revisado",
    decision,
  });
};
beforeAll(async () => {
  f = await paymentExecutionFixture();
  receiver = (
    await createUser(f.db.pool, f.actor, {
      name: "Liquidador Uno",
      login: "receiver",
      password: randomUUID(),
      role: "settlement",
    })
  ).id;
  receiver2 = (
    await createUser(f.db.pool, f.actor, {
      name: "Liquidador Dos",
      login: "receiver-two",
      password: randomUUID(),
      role: "settlement",
    })
  ).id;
}, 120000);
afterAll(async () => {
  await f?.close();
});
it("keeps existing accounts operational and enforces each role in domain and sessions", async () => {
  await expect(
    assertActiveActor(f.db.pool, f.actor, "settlement"),
  ).rejects.toMatchObject({ code: "ROLE_DENIED" });
  await expect(assertActiveActor(f.db.pool, receiver)).rejects.toMatchObject({
    code: "ROLE_DENIED",
  });
  await expect(
    createUser(f.db.pool, receiver, {
      name: "Escalada",
      login: "forbidden",
      password: randomUUID(),
      role: "routes",
    }),
  ).rejects.toMatchObject({ code: "ROLE_DENIED" });
  const password = randomUUID(),
    user = await createUser(f.db.pool, f.actor, {
      name: "Session Receiver",
      login: "session-receiver",
      password,
      role: "settlement",
    });
  const session = await login(f.db.pool, f.db.config, {
    login: user.login,
    password,
  });
  expect(session.user.role).toBe("settlement");
  expect((await authenticate(f.db.pool, f.db.config, session.token)).role).toBe(
    "settlement",
  );
  await expect(
    f.db.pool.query("UPDATE route_users SET role='routes' WHERE id=$1", [
      receiver,
    ]),
  ).rejects.toBeTruthy();
  await setUserActive(f.db.pool, f.actor, user.id, false);
  await expect(
    authenticate(f.db.pool, f.db.config, session.token),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(
    readSettlementDetail(f.db.pool, f.actor, f.executionId),
  ).rejects.toMatchObject({ code: "ROLE_DENIED" });
});
it("requires operational finish and every delivered payment before route-wide settlement", async () => {
  const ownFingerprint = await driverPublicationFingerprint(
    f.db.pool,
    f.members[0].driverId,
  );
  const otherFingerprint = await driverPublicationFingerprint(
    f.db.pool,
    f.members[1].driverId,
  );
  await expect(
    readSettlementDetail(f.db.pool, receiver, f.executionId),
  ).rejects.toMatchObject({ code: "SETTLEMENT_ROUTE_NOT_FINISHED" });
  const invalidDecision = {
    commandId: randomUUID(),
    version: 1,
    basis: "unused",
    decision: "accepted",
    note: "",
  };
  await expect(
    decideSettlement(f.db.pool, receiver, randomUUID(), invalidDecision),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    decideSettlement(f.db.pool, receiver, randomUUID(), {
      ...invalidDecision,
      decision: "other",
    }),
  ).rejects.toMatchObject({ code: "SETTLEMENT_DECISION_INVALID" });
  for (const patch of [
    { note: 1 },
    { note: "x".repeat(2001) },
    { basis: null },
  ])
    await expect(
      decideSettlement(f.db.pool, receiver, randomUUID(), {
        ...invalidDecision,
        ...patch,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(request(null)).rejects.toMatchObject({
    code: "SETTLEMENT_ROUTE_NOT_FINISHED",
  });
  const first = (await mobile()).orders.find(
    (o) => o.shipmentId === f.shipmentRows[0].id,
  )!;
  await confirmOrderPayment(
    f.db.pool,
    f.members[0].authorization,
    f.executionId,
    {
      commandId: randomUUID(),
      shipmentId: first.shipmentId,
      basis: first.basis,
      method: "cash",
      tendered: "15",
      change: "0",
      note: "Resta 5",
    },
    f.timezone,
  );
  await f.finish();
  expect(
    await driverPublicationFingerprint(f.db.pool, f.members[0].driverId),
  ).not.toBe(ownFingerprint);
  expect(
    await driverPublicationFingerprint(f.db.pool, f.members[1].driverId),
  ).toBe(otherFingerprint);
  await expect(request(null)).rejects.toMatchObject({
    code: "SETTLEMENT_PAYMENTS_MISSING",
  });
  const commandId = randomUUID();
  const results = await Promise.all([
    request(first.shipmentId, commandId),
    request(first.shipmentId, commandId),
  ]);
  expect(results[0].id).toBe(results[1].id);
  expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
  await expect(request(first.shipmentId)).rejects.toMatchObject({
    code: "SETTLEMENT_REQUEST_PENDING",
  });
  await expect(request(null, commandId)).rejects.toMatchObject({
    code: "COMMAND_REUSED",
  });
  await expect(request(null)).rejects.toMatchObject({
    code: "SETTLEMENT_REQUEST_PENDING",
  });
  await expect(
    decision(results[0].id, "accepted", f.actor),
  ).rejects.toMatchObject({ code: "ROLE_DENIED" });
  const req = (await mobile()).requests[0];
  const pendingFingerprint = await driverPublicationFingerprint(
    f.db.pool,
    f.members[0].driverId,
  );
  await expect(
    decideSettlement(f.db.pool, receiver, req.id, {
      commandId: randomUUID(),
      version: 1,
      basis: "old",
      decision: "accepted",
      note: "",
    }),
  ).rejects.toMatchObject({ code: "SETTLEMENT_VERSION_CHANGED" });
  const raced = await Promise.allSettled([
    decision(req.id, "accepted", receiver),
    decision(req.id, "rejected", receiver2),
  ]);
  expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const latest = (await mobile()).requests[0];
  if (latest.status === "rejected") {
    const next = await request(first.shipmentId);
    await decision(next.id);
  }
  expect((await mobile()).acceptedTotals[0].cash).toBe("15");
  expect(
    await driverPublicationFingerprint(f.db.pool, f.members[0].driverId),
  ).not.toBe(pendingFingerprint);
  expect(
    await driverPublicationFingerprint(f.db.pool, f.members[1].driverId),
  ).toBe(otherFingerprint);
});
it("excludes accepted cash, releases rejected reservations and records transfer/credit separately", async () => {
  for (const [index, method] of [
    [1, "transfer"],
    [2, "credit"],
  ] as const) {
    const order = (await mobile()).orders.find(
      (o) => o.shipmentId === f.shipmentRows[index].id,
    )!;
    await confirmOrderPayment(
      f.db.pool,
      f.members[0].authorization,
      f.executionId,
      {
        commandId: randomUUID(),
        shipmentId: order.shipmentId,
        basis: order.basis,
        method,
        tendered: method === "credit" ? "0" : "20",
        change: "0",
        note: "",
      },
      f.timezone,
    );
  }
  const req = await request(null);
  const pending = (await mobile()).requests.find((r) => r.id === req.id)!;
  expect(pending.paymentIds).toHaveLength(2);
  expect(pending.totals[0]).toMatchObject({
    cash: "0",
    transfer: "20",
    credit: "20",
  });
  await decision(req.id, "rejected");
  const next = await request(null);
  expect(next.id).not.toBe(req.id);
  const commandId = randomUUID();
  await decision(next.id, "accepted", receiver, commandId);
  expect(
    await decision(next.id, "accepted", receiver, commandId),
  ).toMatchObject({ duplicate: true });
  await expect(
    decision(next.id, "rejected", receiver, commandId),
  ).rejects.toMatchObject({ code: "COMMAND_REUSED" });
  await expect(request(null)).rejects.toMatchObject({
    code: "SETTLEMENT_NOTHING_PENDING",
  });
  const result = await readSettlementDetail(f.db.pool, receiver, f.executionId);
  expect(result.outstandingTotals).toEqual([]);
  expect(result.acceptedTotals[0]).toMatchObject({
    cash: "15",
    transfer: "20",
    credit: "20",
    balance: "5",
  });
  const report = await listSettlements(
    f.db.pool,
    receiver,
    new URLSearchParams({ from: "2026-09-24", to: "2026-09-24" }),
    f.timezone,
  );
  expect(report.rows).toHaveLength(1);
  expect(report.metrics.find((m) => m.stage === "accepted")).toMatchObject({
    cash: "15",
    transfer: "20",
    credit: "20",
  });
  expect(
    (
      await listSettlements(
        f.db.pool,
        receiver,
        new URLSearchParams({ from: "2026-09-23", to: "2026-09-23" }),
        f.timezone,
      )
    ).rows,
  ).toEqual([]);
  await expect(
    f.db.pool.query("DELETE FROM route_settlement_claims"),
  ).rejects.toBeTruthy();
  await expect(
    f.db.pool.query(
      "UPDATE route_settlement_requests SET snapshot='{}'::jsonb",
    ),
  ).rejects.toBeTruthy();
  await migrate(f.db.pool, f.db.config.instanceId);
  expect((await mobile()).acceptedTotals[0].cash).toBe("15");
});

it("filters receipts by the actual local acceptance day and preserves archived-route history", async () => {
  const { readFinanceEvidence } = await import("../src/core/finance-evidence");
  await expect(
    readFinanceEvidence(
      f.db.pool,
      { actor: receiver },
      f.executionId,
      randomUUID(),
      randomUUID(),
      f.photoRoot,
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const { todayInTimezone } = await import("../src/core/local-date");
  const receiptDate = todayInTimezone(f.timezone);
  const query = (from: string, to = from) =>
    new URLSearchParams({ from, to, dateBasis: "receipt" });
  const receipts = await listSettlements(
    f.db.pool,
    receiver,
    query(receiptDate),
    f.timezone,
  );
  expect(receipts.rows).toHaveLength(1);
  expect(receipts.metrics).toHaveLength(1);
  expect(receipts.metrics[0]).toMatchObject({
    stage: "accepted",
    cash: "15",
    credit: "20",
    transfer: "20",
  });
  expect(
    (
      await listSettlements(
        f.db.pool,
        receiver,
        query("2026-09-23"),
        f.timezone,
      )
    ).rows,
  ).toEqual([]);
  await expect(
    listSettlements(
      f.db.pool,
      receiver,
      new URLSearchParams({ dateBasis: "invalid" }),
      f.timezone,
    ),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const { archiveWeeklyPlans } = await import("../src/core/plan-archive");
  await archiveWeeklyPlans(
    f.db.pool,
    f.timezone,
    new Date("2026-10-05T12:00:00Z"),
  );
  expect((await mobile()).acceptedTotals[0].cash).toBe("15");
  expect(
    (
      await readSettlementDetail(f.db.pool, receiver, f.executionId)
    ).orders.every((o) => o.payment?.snapshot.financial),
  ).toBe(true);
  await f.db.pool.query(
    "UPDATE route_driver_mobile_devices SET revoked_at=now() WHERE id=$1",
    [f.members[0].deviceId],
  );
  await expect(mobile()).rejects.toMatchObject({
    code: "MOBILE_UNAUTHENTICATED",
  });
});
