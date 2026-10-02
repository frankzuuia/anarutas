import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { paymentExecutionFixture } from "./helpers/payment-execution";
import { financialObservation } from "./helpers/financial";
import { createUser, setUserActive } from "../src/core/auth";
import { createDriver } from "../src/core/fleet";
import { transaction } from "../src/core/database";
import { buildFinancialSnapshot } from "../src/core/financial-policy";
import { persistFinancialSnapshot } from "../src/core/financial-store";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import { executeDriverOrderCommand } from "../src/core/driver-order-command";
import {
  listSettlements,
  readMobileFinanceDetail,
} from "../src/core/finance-read";
import { confirmOrderPayment } from "../src/core/payments";
import { requestSettlement, decideSettlement } from "../src/core/settlements";

let f: Awaited<ReturnType<typeof paymentExecutionFixture>>,
  receiver: string,
  inactiveDriver: string;
const query = (patch: Record<string, string> = {}) =>
  new URLSearchParams({
    from: "2026-09-24",
    to: "2026-09-24",
    ...patch,
  });
const report = (patch: Record<string, string> = {}, actor = receiver) =>
  listSettlements(f.db.pool, actor, query(patch), f.timezone);

beforeAll(async () => {
  f = await paymentExecutionFixture();
  receiver = (
    await createUser(f.db.pool, f.actor, {
      name: "Liquidador filtros",
      login: "filter-receiver",
      password: randomUUID(),
      role: "settlement",
    })
  ).id;
  inactiveDriver = (
    await createDriver(f.db.pool, f.actor, {
      id: randomUUID(),
      name: "Chofer histórico sin cobros",
      phone: "3310000002",
      emergency_name: "Contacto privado",
      emergency_phone: "3310000003",
      blood_type: "O+",
      active: false,
    })
  ).id;
  const first = await readMobileFinanceDetail(
    f.db.pool,
    f.members[0].authorization,
    f.executionId,
  );
  for (const order of first.orders)
    await confirmOrderPayment(
      f.db.pool,
      f.members[0].authorization,
      f.executionId,
      {
        commandId: randomUUID(),
        shipmentId: order.shipmentId,
        basis: order.basis,
        method: "cash",
        tendered: "20",
        change: "0",
        note: "",
      },
      f.timezone,
    );

  // Second driver uses real start/arrival/delivery/payment commands on another vehicle.
  const member = f.members[1];
  await f.start(member);
  let route = await readDriverExecution(
    f.db.pool,
    member.driverId,
    f.planId,
    f.timezone,
  );
  const shipment = (
    await f.db.pool.query("SELECT * FROM route_shipments WHERE vehicle_id=$1", [
      member.vehicleId,
    ])
  ).rows[0];
  const observation = financialObservation();
  observation.picking.id = Number(shipment.picking_id);
  observation.picking.partnerId = Number(shipment.partner_id);
  observation.relatedPickings = [structuredClone(observation.picking)];
  observation.order.id = Number(shipment.order_id);
  observation.moves[0].id =
    observation.moves[0].productId =
    observation.moves[0].pickingId =
      Number(shipment.picking_id);
  observation.saleLines[0].productId = Number(shipment.picking_id);
  await transaction(f.db.pool, (sql) =>
    persistFinancialSnapshot(
      sql,
      buildFinancialSnapshot(
        {
          source: shipment.source,
          pickingId: Number(shipment.picking_id),
          orderId: Number(shipment.order_id),
          partnerId: Number(shipment.partner_id),
        },
        observation,
      ),
      60,
      1,
    ),
  );
  const identity = () => ({
    commandId: randomUUID(),
    executionId: route.id,
    publicationRevision: route.publicationRevision,
    executionRevision: route.revision,
    stopVersion: route.stops[0].version,
    visitSequence: route.stops[0].visitSequence,
    policyVersion: route.policy.version,
  });
  await executeStopCommand(
    f.db.pool,
    member.authorization,
    f.planId,
    route.stops[0].id,
    "arrival",
    {
      ...identity(),
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
  route = await readDriverExecution(
    f.db.pool,
    member.driverId,
    f.planId,
    f.timezone,
  );
  await executeDriverOrderCommand(
    f.db.pool,
    member.authorization,
    f.planId,
    route.stops[0].id,
    shipment.id,
    {
      ...identity(),
      kind: "deliver",
      orderVersion: route.stops[0].orderStates[0].version,
    },
    f.timezone,
    f.now,
  );
  const second = await readMobileFinanceDetail(
    f.db.pool,
    member.authorization,
    route.id,
  );
  await confirmOrderPayment(
    f.db.pool,
    member.authorization,
    route.id,
    {
      commandId: randomUUID(),
      shipmentId: shipment.id,
      basis: second.orders[0].basis,
      method: "transfer",
      tendered: "20",
      change: "0",
      note: "",
    },
    f.timezone,
  );
  const request = await requestSettlement(
    f.db.pool,
    f.members[0].authorization,
    f.executionId,
    {
      commandId: randomUUID(),
      shipmentId: first.orders[0].shipmentId,
    },
  );
  const detail = await readMobileFinanceDetail(
    f.db.pool,
    f.members[0].authorization,
    f.executionId,
  );
  const pending = detail.requests.find((r) => r.id === request.id)!;
  await decideSettlement(f.db.pool, receiver, request.id, {
    commandId: randomUUID(),
    version: pending.version,
    basis: pending.basis,
    decision: "accepted",
    note: "",
  });
}, 120000);
afterAll(async () => {
  await f?.close();
});

it("filters both executions and all money stages by the selected registered driver", async () => {
  const all = await report();
  expect(all.rows.map((r) => r.driverId).sort()).toEqual(
    f.members.map((m) => m.driverId).sort(),
  );
  expect(all.metrics).toMatchObject([
    { stage: "accepted", cash: "20", transfer: "0", credit: "0" },
    { stage: "collected", cash: "60", transfer: "20", credit: "0" },
  ]);
  const first = await report({ driverId: f.members[0].driverId });
  expect(first.rows).toHaveLength(1);
  expect(first.rows[0].driverId).toBe(f.members[0].driverId);
  expect(first.metrics).toMatchObject([
    { stage: "accepted", cash: "20", transfer: "0" },
    { stage: "collected", cash: "60", transfer: "0" },
  ]);
  const second = await report({ driverId: f.members[1].driverId });
  expect(second.rows).toHaveLength(1);
  expect(second.rows[0].driverId).toBe(f.members[1].driverId);
  expect(second.metrics).toMatchObject([
    { stage: "collected", cash: "0", transfer: "20" },
  ]);
});

it("lists the minimal registered roster including inactive drivers independently of dates and pagination", async () => {
  const all = await report();
  expect(all.drivers).toEqual([
    { id: f.members[0].driverId, name: "Chofer 0", active: true },
    { id: f.members[1].driverId, name: "Chofer 1", active: true },
    { id: inactiveDriver, name: "Chofer histórico sin cobros", active: false },
  ]);
  const emptyCases: Record<string, string>[] = [
    { driverId: inactiveDriver },
    { from: "2026-09-23", to: "2026-09-23" },
    { page: "4" },
  ];
  for (const patch of emptyCases) {
    const filtered = await report(patch);
    expect(filtered.drivers).toEqual(all.drivers);
    expect(filtered.rows).toEqual([]);
    if (!("page" in patch)) expect(filtered.metrics).toEqual([]);
  }
  const unknown = await report({ driverId: randomUUID() });
  expect(unknown.rows).toEqual([]);
  expect(unknown.metrics).toEqual([]);
});

it("rejects malformed filters and unauthorized or deactivated receivers before returning the roster", async () => {
  await expect(report({}, f.actor)).rejects.toMatchObject({
    code: "ROLE_DENIED",
  });
  const invalidCases: Record<string, string>[] = [
    { driverId: "invalid" },
    { page: "-1" },
  ];
  for (const patch of invalidCases)
    await expect(report(patch)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  await expect(
    report({ from: "2026-09-25", to: "2026-09-24" }),
  ).rejects.toMatchObject({ code: "INVALID_DATE" });
  const user = await createUser(f.db.pool, f.actor, {
    name: "Revocado",
    login: "revoked-receiver",
    password: randomUUID(),
    role: "settlement",
  });
  await setUserActive(f.db.pool, f.actor, user.id, false);
  await expect(report({}, user.id)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
});

it("reads filters concurrently without changing receipts, claims, requests or audit history", async () => {
  const snapshot = async () =>
    (
      await f.db.pool.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM route_order_payments p) AS payments,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM route_settlement_requests r) AS requests,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY payment_id) FROM route_settlement_claims c) AS claims,
    (SELECT count(*)::int FROM route_audit) AS audit`)
    ).rows;
  const before = await snapshot();
  const reads = await Promise.all(
    f.members.map((m) => report({ driverId: m.driverId })),
  );
  expect(reads.map((r) => r.rows[0].driverId)).toEqual(
    f.members.map((m) => m.driverId),
  );
  expect(await snapshot()).toEqual(before);
});
