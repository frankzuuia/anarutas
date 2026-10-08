import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import sharp from "sharp";
import { executionFixture } from "./helpers/driver-execution";
import { financialObservation } from "./helpers/financial";
import { buildFinancialSnapshot } from "../src/core/financial-policy";
import { persistFinancialSnapshot } from "../src/core/financial-store";
import { migrate, transaction } from "../src/core/database";
import { readDriverPlan } from "../src/core/driver-mobile-route";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import {
  reportProductIncident,
  changeProductIncident,
  resolveProductIncident,
  classifyProductIncident,
} from "../src/core/product-incidents";
import { reportProductIncidentWithEvidence } from "../src/core/product-incidents-evidence";
import { driverPublicationFingerprint } from "../src/core/driver-mobile-events";
import { publicationFinancialFingerprint } from "../src/core/driver-financial-store";
import type { FinancialSnapshot } from "../src/core/financial-contract";
import type { DriverFinancialView } from "../src/core/driver-financial-contract";

let f: Awaited<ReturnType<typeof executionFixture>>,
  shipment: string,
  stopId: string,
  snapshot: FinancialSnapshot;
let revision = 1;
const state = () =>
  readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
const plan = () =>
  readDriverPlan(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
const projected = async (): Promise<DriverFinancialView> =>
  (await plan()).orders.find((o: { id: string }) => o.id === shipment)
    .financial;
const identity = async () => {
  const r = await state(),
    s = r.stops.find((stop) => stop.id === stopId)!;
  return {
    commandId: randomUUID(),
    executionId: r.id,
    publicationRevision: r.publicationRevision,
    executionRevision: r.revision,
    stopVersion: s.version,
    visitSequence: s.visitSequence,
    orderVersion: s.orderStates.find((o) => o.shipmentId === shipment)!.version,
  };
};
const payload = async (quantity: string) => ({
  ...(await identity()),
  kind: "shortage_validation",
  department: "Operaciones",
  concept: "Picking",
  comments: [],
  formVersion: 2,
  financialContractVersion: 1,
  financial: { revision, moveId: 1, saleLineId: 10 },
  lineIndex: 0,
  quantity,
});
const report = async (body: Record<string, unknown>) =>
  reportProductIncident(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stopId,
    shipment,
    body,
    f.timezone,
  );
const persist = async (s = snapshot) => {
  revision = (
    await transaction(f.db.pool, (sql) =>
      persistFinancialSnapshot(sql, s, 60, 1),
    )
  ).revision;
  // PostgreSQL and Node may resolve the Windows clock a few milliseconds
  // apart. A fresh-source scenario needs the caller clock to have reached
  // the committed observation; the production future-date guard stays strict.
  const observed = (
    await f.db.pool.query<{ last_success_at: Date }>(
      "SELECT last_success_at FROM route_financial_targets WHERE source=$1 AND picking_id=$2 AND order_id=$3",
      [s.target.source, s.target.pickingId, s.target.orderId],
    )
  ).rows[0].last_success_at.getTime();
  await expect.poll(() => Date.now()).toBeGreaterThanOrEqual(observed);
};

beforeAll(async () => {
  f = await executionFixture();
  const row = (
    await f.db.pool.query("SELECT * FROM route_shipments WHERE picking_id=1")
  ).rows[0];
  shipment = row.id;
  const observation = financialObservation();
  observation.moves[0] = {
    ...observation.moves[0],
    id: 1,
    productId: 1,
    quantity: "5.12",
    demand: "5.12",
  };
  observation.saleLines[0] = {
    ...observation.saleLines[0],
    productId: 1,
    quantity: "5.12",
    delivered: "5.12",
    amounts: { untaxed: "51.2", tax: "0", total: "51.2" },
  };
  observation.order.amounts = { untaxed: "51.2", tax: "0", total: "51.2" };
  snapshot = buildFinancialSnapshot(
    { source: row.source, pickingId: 1, orderId: 1, partnerId: 1 },
    observation,
  );
  expect(snapshot.status).toBe("ready");
  await f.start();
  const r = await state();
  stopId = r.stops.find((s) => s.shipmentIds.includes(shipment))!.id;
  await executeStopCommand(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stopId,
    "arrival",
    {
      ...(await identity()),
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
}, 120000);
afterAll(async () => {
  await f?.close();
});

it("refreshes a published route by stable IDs without rewriting it and rejects unowned reads", async () => {
  const before = (await plan()).orders;
  const fingerprint = await driverPublicationFingerprint(
    f.db.pool,
    f.members[0].driverId,
  );
  expect(await projected()).toMatchObject({
    status: "unavailable",
    totals: null,
  });
  const pending = structuredClone(snapshot);
  pending.status = "pending_validation";
  pending.shipmentAmounts = null;
  await persist(pending);
  expect(await projected()).toMatchObject({
    status: "pending_validation",
    totals: null,
  });
  await persist();
  const financial = await projected();
  expect(financial).toMatchObject({
    status: "ready",
    fresh: true,
    totals: { original: "51.2", net: "51.2" },
    lines: [
      {
        quantity: "5.12",
        moveId: 1,
        unitPrice: "10",
        physicalRemaining: "5.12",
      },
    ],
  });
  expect((await plan()).orders.map((o: { lines: unknown }) => o.lines)).toEqual(
    before.map((o: { lines: unknown }) => o.lines),
  );
  expect(
    await driverPublicationFingerprint(f.db.pool, f.members[0].driverId),
  ).not.toBe(fingerprint);
  expect(
    JSON.stringify(
      await readDriverPlan(
        f.db.pool,
        f.members[1].driverId,
        f.planId,
        f.timezone,
      ),
    ),
  ).not.toContain(shipment);
  await expect(
    readDriverPlan(f.db.pool, randomUUID(), f.planId, f.timezone),
  ).rejects.toMatchObject({ status: 404 });
  const visible = [{ planId: f.planId, vehicleId: f.members[0].vehicleId }];
  expect(
    await publicationFinancialFingerprint(f.db.pool, visible, new Date()),
  ).not.toEqual(
    await publicationFinancialFingerprint(
      f.db.pool,
      visible,
      new Date(Date.now() + 181000),
    ),
  );
});
it("guards freshness, source version, exact IDs and bypass attempts before recording money", async () => {
  const valid = await payload("1");
  for (const financial of [
    { ...valid.financial, revision: revision - 1 },
    { ...valid.financial, moveId: 2 },
    { ...valid.financial, saleLineId: 11 },
  ])
    await expect(report({ ...valid, financial })).rejects.toMatchObject({
      status: 409,
    });
  const { financial: omitted, ...unpriced } = valid;
  void omitted;
  await expect(report({ ...unpriced, kind: "return" })).rejects.toMatchObject({
    code: "PRODUCT_EVIDENCE_REQUIRED",
  });
  await f.db.pool.query(
    "UPDATE route_financial_targets SET last_success_at=now()-interval '181 seconds' WHERE picking_id=1",
  );
  await expect(report(valid)).rejects.toMatchObject({
    code: "FINANCIAL_SOURCE_STALE",
  });
  expect((await projected()).fresh).toBe(false);
  await persist();
  await f.db.pool.query(
    "UPDATE route_financial_targets SET last_success_at=now()+interval '181 seconds' WHERE picking_id=1",
  );
  await expect(report(valid)).rejects.toMatchObject({
    code: "FINANCIAL_SOURCE_STALE",
  });
  expect((await projected()).fresh).toBe(false);
  await persist();
  await f.db.pool.query(
    "UPDATE route_financial_targets SET last_error='ODOO_UNAVAILABLE' WHERE picking_id=1",
  );
  await expect(report(valid)).rejects.toMatchObject({
    code: "FINANCIAL_SOURCE_STALE",
  });
  await persist();
  await expect(
    report({ ...valid, quantity: "5.120001" }),
  ).rejects.toMatchObject({ code: "INCIDENT_QUANTITY_EXCEEDED" });
  const stateBefore = await state();
  await expect(
    reportProductIncident(
      f.db.pool,
      f.members[1].authorization,
      f.planId,
      stopId,
      shipment,
      valid,
      f.timezone,
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect((await state()).revision).toBe(stateBefore.revision);
});
it("saves exact final quantity, replays once, serializes concurrency, edits, resolves and cancels without losing history", async () => {
  const firstPayload = await payload("4");
  const first = await report(firstPayload);
  expect((await report(firstPayload)).duplicate).toBe(true);
  expect(await projected()).toMatchObject({
    totals: { deduction: "40", net: "11.2" },
    lines: [{ physicalRemaining: "1.12" }],
  });
  const parallel = await payload("1.12");
  const raced = await Promise.allSettled([
    report(parallel),
    report({ ...parallel, commandId: randomUUID() }),
  ]);
  expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await projected()).toMatchObject({
    totals: { net: "0", deduction: "51.2" },
  });
  const second = (await state()).stops
    .find((s) => s.id === stopId)!
    .productIncidents.find((i) => i.id !== first.incidentId)!;
  const amend = { ...(await payload("1")), expectedVersion: 1 };
  await changeProductIncident(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stopId,
    shipment,
    first.incidentId!,
    amend,
    "amend",
  );
  expect(await projected()).toMatchObject({
    totals: { net: "30", deduction: "21.2" },
  });
  await expect(
    f.db.pool.query(
      "UPDATE route_product_incidents SET quantity=5,version=version+1 WHERE id=$1",
      [first.incidentId],
    ),
  ).rejects.toThrow("INCIDENT_QUANTITY_EXCEEDED");
  await expect(
    f.db.pool.query(
      "UPDATE route_product_incidents SET financial_move_id=2,version=version+1 WHERE id=$1",
      [first.incidentId],
    ),
  ).rejects.toThrow();
  await resolveProductIncident(f.db.pool, f.actor, second.id, {
    expectedVersion: 1,
    note: "Atendido",
  });
  expect((await projected()).totals?.deduction).toBe("21.2");
  await changeProductIncident(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stopId,
    shipment,
    first.incidentId!,
    { ...(await identity()), expectedVersion: 2 },
    "cancel",
  );
  expect((await projected()).totals?.deduction).toBe("11.2");
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM route_product_incident_changes WHERE incident_id=$1",
        [first.incidentId],
      )
    ).rows[0].n,
  ).toBe(2);
  const publications = (
    await f.db.pool.query(
      "SELECT snapshot FROM route_plan_publications ORDER BY vehicle_id",
    )
  ).rows;
  const incidents = (
    await f.db.pool.query("SELECT * FROM route_product_incidents ORDER BY id")
  ).rows;
  await f.db.pool.query("UPDATE rutas_installation SET schema_version=34");
  await migrate(f.db.pool, f.db.config.instanceId);
  await migrate(f.db.pool, f.db.config.instanceId);
  expect(
    (await f.db.pool.query("SELECT * FROM route_product_incidents ORDER BY id"))
      .rows,
  ).toEqual(incidents);
  expect(
    (
      await f.db.pool.query(
        "SELECT snapshot FROM route_plan_publications ORDER BY vehicle_id",
      )
    ).rows,
  ).toEqual(publications);
});
it("requires replacement payment choice and retains it in execution, history and financial projection", async () => {
  const photo = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#334455" },
  })
    .jpeg()
    .toBuffer();
  const body = {
    ...(await payload("1")),
    kind: "replacement_quality",
    replacementPayment: "pay_full",
  };
  const result = await reportProductIncidentWithEvidence(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stopId,
    shipment,
    body,
    f.timezone,
    photo,
    "image/jpeg",
    f.photoRoot,
  );
  expect((await projected()).totals).toMatchObject({
    deferred: "0",
    net: "40",
  });
  expect(
    (await state()).stops
      .find((s) => s.id === stopId)!
      .productIncidents.find((i) => i.id === result.incidentId),
  ).toMatchObject({
    replacementPayment: "pay_full",
    financial: body.financial,
  });
  const edited = {
    ...(await payload("1")),
    kind: "replacement_wrong_product",
    replacementPayment: "defer",
    expectedVersion: 1,
  };
  await changeProductIncident(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stopId,
    shipment,
    result.incidentId!,
    edited,
    "amend",
  );
  expect((await projected()).totals).toMatchObject({
    deferred: "10",
    net: "30",
  });
  const before = await projected();
  const orderBeforeClassification = (await state()).stops.find(s => s.id === stopId)!.orderStates;
  await classifyProductIncident(f.db.pool, f.actor, result.incidentId!, {
    expectedVersion: 2, department: "Compras", concept: "Error en compra", comment: "Corrección administrativa sin cambiar el cobro",
  });
  expect((await projected()).totals).toEqual(before.totals);
  expect((await projected()).lines).toEqual(before.lines);
  expect((await state()).stops.find(s => s.id === stopId)!.orderStates).toEqual(orderBeforeClassification);
  const refresh = structuredClone(snapshot);
  refresh.order.writeDate = "2026-10-01T00:00:00Z";
  await persist(refresh);
  expect((await projected()).totals).toEqual(before.totals);
  const changed = structuredClone(refresh);
  changed.saleLines[0].unitPrice = "11";
  await persist(changed);
  expect(await projected()).toMatchObject({
    totals: null,
    issues: ["INCIDENT_FINANCIAL_REVIEW_REQUIRED"],
  });
  expect(
    (
      await reportProductIncidentWithEvidence(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        stopId,
        shipment,
        body,
        f.timezone,
        photo,
        "image/jpeg",
        f.photoRoot,
      )
    ).duplicate,
  ).toBe(true);
  await persist(snapshot);
});
