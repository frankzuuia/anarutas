import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { executionFixture } from "./helpers/driver-execution";
import { financialObservation } from "./helpers/financial";
import {
  acquireFinancialSync,
  dueFinancialTargets,
  persistFinancialSnapshot,
  readShipmentFinancials,
  releaseFinancialSync,
} from "../src/core/financial-store";
import {
  buildFinancialSnapshot,
  financialHash,
} from "../src/core/financial-policy";
import { migrate, transaction } from "../src/core/database";
import {
  recordFinancialFailure,
  syncFinancialSources,
} from "../src/core/financial-sync";
import { financialSyncConfig } from "../src/core/financial-config";
import { AppError } from "../src/core/errors";
import { createPlan } from "../src/core/plans";
import { persistImportPage } from "../src/core/orders";
import type { FinancialTarget } from "../src/core/financial-contract";

let f: Awaited<ReturnType<typeof executionFixture>>;
let target: FinancialTarget;
let shipmentId: string;
beforeAll(async () => {
  f = await executionFixture();
  const row = (
    await f.db.pool.query("SELECT * FROM route_shipments WHERE picking_id=1")
  ).rows[0];
  target = { source: row.source, pickingId: 1, orderId: 1, partnerId: 1 };
  shipmentId = row.id;
}, 120_000);
afterAll(async () => {
  await f?.close();
});

it("automatically tracks imports and backfills schema33 without changing operational data; migration is repeatable", async () => {
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS count FROM route_financial_targets",
      )
    ).rows[0].count,
  ).toBe(4);
  const before = (
    await f.db.pool.query("SELECT * FROM route_shipments ORDER BY id")
  ).rows;
  await f.db.pool.query(
    "DROP TABLE route_financial_revisions,route_financial_targets,route_financial_sync_state; UPDATE rutas_installation SET schema_version=33",
  );
  await migrate(f.db.pool, f.db.config.instanceId);
  await migrate(f.db.pool, f.db.config.instanceId);
  expect(
    (await f.db.pool.query("SELECT schema_version FROM rutas_installation"))
      .rows[0].schema_version,
  ).toBe(45);
  expect(
    (await f.db.pool.query("SELECT * FROM route_shipments ORDER BY id")).rows,
  ).toEqual(before);
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS count FROM route_financial_targets",
      )
    ).rows[0].count,
  ).toBe(4);
  expect(
    await readShipmentFinancials(f.db.pool, f.actor, shipmentId),
  ).toMatchObject({ revision: 0, snapshot: null, last_success_at: null });
});
it("deduplicates the same picking/order across plans, rejects a changed customer and rolls back failed imports", async () => {
  const plan = await createPlan(f.db.pool, f.actor, {
    date: "2026-09-30",
    label: "Financial duplicate QA",
  });
  const original = (
    await f.db.pool.query("SELECT snapshot FROM route_shipments WHERE id=$1", [
      shipmentId,
    ])
  ).rows[0].snapshot;
  const page = {
    fingerprint: target.source,
    shipments: [original],
    nextCursor: 1,
    ceiling: 1,
    hasMore: false,
    inspected: 1,
    excluded: 0,
  };
  await persistImportPage(f.db.pool, f.actor, plan.id, page);
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS count FROM route_financial_targets",
      )
    ).rows[0].count,
  ).toBe(4);
  const other = await createPlan(f.db.pool, f.actor, {
    date: "2026-10-01",
    label: "Conflicting identity QA",
  });
  await expect(
    persistImportPage(f.db.pool, f.actor, other.id, {
      ...page,
      shipments: [{ ...original, partnerId: 333 }],
    }),
  ).rejects.toThrow("FINANCIAL_IDENTITY_CHANGED");
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS count FROM route_shipments WHERE plan_id=$1",
        [other.id],
      )
    ).rows[0].count,
  ).toBe(0);
});
it("preserves ready snapshots through errors, increments only on changes and rejects revision mutations", async () => {
  const snapshot = buildFinancialSnapshot(target, financialObservation());
  expect(
    await transaction(f.db.pool, (sql) =>
      persistFinancialSnapshot(sql, snapshot, 60, 12),
    ),
  ).toEqual({ changed: true, revision: 1 });
  expect(
    await transaction(f.db.pool, (sql) =>
      persistFinancialSnapshot(sql, snapshot, 60, 12),
    ),
  ).toEqual({ changed: false, revision: 1 });
  const stored = await readShipmentFinancials(f.db.pool, f.actor, shipmentId);
  expect(stored).toMatchObject({
    revision: 1,
    snapshot,
    failures: 0,
    last_duration_ms: 12,
  });
  expect(Number(stored.age_seconds)).toBeGreaterThanOrEqual(0);
  await f.db.pool.query(
    "INSERT INTO route_financial_sync_state(source) VALUES($1)",
    [target.source],
  );
  const config = financialSyncConfig({});
  const failed = await transaction(f.db.pool, (sql) =>
    recordFinancialFailure(
      sql,
      target.source,
      [target],
      new AppError("ODOO_RATE_LIMITED", 503, { retryAfterSeconds: 7200 }),
      0,
      config,
      31,
    ),
  );
  expect(failed).toEqual({ code: "ODOO_RATE_LIMITED", retrySeconds: 7200 });
  expect(
    await readShipmentFinancials(f.db.pool, f.actor, shipmentId),
  ).toMatchObject({
    revision: 1,
    snapshot,
    failures: 1,
    last_error: "ODOO_RATE_LIMITED",
  });
  const state = (
    await f.db.pool.query(
      "SELECT *,EXTRACT(EPOCH FROM next_attempt_at-now()) AS delay FROM route_financial_sync_state",
    )
  ).rows[0];
  expect(state.rate_limits).toBe("1");
  expect(state.errors).toBe("1");
  expect(Number(state.delay)).toBeGreaterThan(7190);
  for (const query of [
    "UPDATE route_financial_revisions SET snapshot='{}'",
    "DELETE FROM route_financial_revisions",
  ])
    await expect(f.db.pool.query(query)).rejects.toThrow(
      "FINANCIAL_REVISION_IMMUTABLE",
    );
  await expect(
    transaction(f.db.pool, (sql) =>
      persistFinancialSnapshot(
        sql,
        { ...snapshot, target: { ...target, partnerId: 9 } },
        60,
        1,
      ),
    ),
  ).rejects.toThrow("FINANCIAL_IDENTITY_CHANGED");
  await expect(
    transaction(f.db.pool, (sql) =>
      persistFinancialSnapshot(
        sql,
        { ...snapshot, target: { ...target, pickingId: 99 } },
        60,
        1,
      ),
    ),
  ).rejects.toThrow("FINANCIAL_IDENTITY_CHANGED");
});
it("financial updates preserve the complete started publication, shipment and execution; failures roll back", async () => {
  await f.start();
  const tables = [
    "route_shipments",
    "route_plan_publications",
    "route_driver_executions",
    "route_driver_execution_orders",
  ];
  const before = await Promise.all(
    tables.map(
      async (name) => (await f.db.pool.query(`SELECT * FROM ${name}`)).rows,
    ),
  );
  const observation = financialObservation();
  observation.saleLines[0].unitPrice = "11";
  observation.saleLines[0].amounts = { untaxed: "22", tax: "0", total: "22" };
  observation.order.amounts = { ...observation.saleLines[0].amounts };
  const snapshot = buildFinancialSnapshot(target, observation);
  await expect(
    transaction(f.db.pool, async (sql) => {
      await persistFinancialSnapshot(sql, snapshot, 60, 20);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(
    (await readShipmentFinancials(f.db.pool, f.actor, shipmentId)).revision,
  ).toBe(1);
  expect(
    await transaction(f.db.pool, (sql) =>
      persistFinancialSnapshot(sql, snapshot, 60, 20),
    ),
  ).toEqual({ changed: true, revision: 2 });
  const after = await Promise.all(
    tables.map(
      async (name) => (await f.db.pool.query(`SELECT * FROM ${name}`)).rows,
    ),
  );
  expect(after.map(financialHash)).toEqual(before.map(financialHash));
  await expect(
    f.db.pool.query("UPDATE route_shipments SET snapshot='{}' WHERE id=$1", [
      shipmentId,
    ]),
  ).rejects.toMatchObject({ code: "PZR01" });
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS count FROM route_financial_revisions",
      )
    ).rows[0].count,
  ).toBe(2);
});
it("concurrent writers cannot duplicate a revision, and source locks exclude workers until release or connection loss", async () => {
  const snapshot = buildFinancialSnapshot(target, financialObservation());
  const results = await Promise.all(
    [1, 2].map(() =>
      transaction(f.db.pool, (sql) =>
        persistFinancialSnapshot(sql, snapshot, 60, 1),
      ),
    ),
  );
  expect(results.filter((result) => result.changed)).toHaveLength(1);
  expect(results.map((result) => result.revision)).toEqual([3, 3]);
  const first = await f.db.pool.connect(),
    second = await f.db.pool.connect();
  try {
    expect(await acquireFinancialSync(first, target.source)).toBe(true);
    expect(await acquireFinancialSync(second, target.source)).toBe(false);
    await releaseFinancialSync(first, target.source);
    expect(await acquireFinancialSync(second, target.source)).toBe(true);
    await releaseFinancialSync(second, target.source);
    await acquireFinancialSync(first, target.source);
  } finally {
    first.release(true);
    second.release();
  }
  const recovered = await f.db.pool.connect();
  try {
    expect(await acquireFinancialSync(recovered, target.source)).toBe(true);
    await releaseFinancialSync(recovered, target.source);
  } finally {
    recovered.release();
  }
});
it("authorizes active admins and rejects absent/inactive actors and unknown shipments", async () => {
  await expect(
    readShipmentFinancials(f.db.pool, randomUUID(), shipmentId),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(
    readShipmentFinancials(f.db.pool, f.members[0].driverId, shipmentId),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(
    readShipmentFinancials(f.db.pool, f.actor, randomUUID()),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    readShipmentFinancials(f.db.pool, f.actor, "invalid"),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await f.db.pool.query("UPDATE route_users SET active=false WHERE id=$1", [
    f.actor,
  ]);
  await expect(
    readShipmentFinancials(f.db.pool, f.actor, shipmentId),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await f.db.pool.query("UPDATE route_users SET active=true WHERE id=$1", [
    f.actor,
  ]);
});
it("isolates source/installations before any Odoo request; cooldown and contention do no remote work", async () => {
  const config = {
    fingerprint: target.source,
    url: "https://unused.invalid",
    database: "",
    username: "",
    credential: "",
    companyId: 1,
    timeoutMs: 1000,
    pickerNoteField: "",
    pickerNoteLabel: "",
  };
  await expect(
    syncFinancialSources(f.db.pool, randomUUID(), config),
  ).rejects.toMatchObject({ code: "INSTALLATION_MISMATCH" });
  await expect(
    syncFinancialSources(f.db.pool, f.db.config.instanceId, {
      ...config,
      fingerprint: "other",
    }),
  ).rejects.toMatchObject({ code: "ODOO_SOURCE_CHANGED" });
  expect(
    await syncFinancialSources(f.db.pool, f.db.config.instanceId, config),
  ).toEqual({ status: "cooldown" });
  const blocker = await f.db.pool.connect();
  try {
    await acquireFinancialSync(blocker, target.source);
    expect(
      await syncFinancialSources(f.db.pool, f.db.config.instanceId, config),
    ).toEqual({ status: "busy" });
    await releaseFinancialSync(blocker, target.source);
  } finally {
    blocker.release();
  }
  await f.db.pool.query(
    "UPDATE route_financial_sync_state SET next_attempt_at=now(); UPDATE route_financial_targets SET next_attempt_at=now()+interval '1 day'",
  );
  expect(
    await syncFinancialSources(f.db.pool, f.db.config.instanceId, config),
  ).toEqual({ status: "idle" });
  await f.db.pool.query(
    "UPDATE route_financial_targets SET next_attempt_at=now()",
  );
  const previous = (
    await readShipmentFinancials(f.db.pool, f.actor, shipmentId)
  ).snapshot;
  // Real TCP refusal on localhost, no replacement server and no mocked transport.
  const failure = await syncFinancialSources(
    f.db.pool,
    f.db.config.instanceId,
    { ...config, url: "https://127.0.0.1:9" },
  );
  expect(failure).toMatchObject({ status: "failed", code: "ODOO_UNAVAILABLE" });
  expect(
    (await readShipmentFinancials(f.db.pool, f.actor, shipmentId)).snapshot,
  ).toEqual(previous);
  expect(
    await syncFinancialSources(f.db.pool, f.db.config.instanceId, config),
  ).toEqual({ status: "cooldown" });
});
it("due queue is source scoped, ordered, bounded and retains revisions when plans are archived", async () => {
  const client = await f.db.pool.connect();
  try {
    await client.query(
      "UPDATE route_financial_targets SET next_attempt_at='2000-01-01',failures=0",
    );
    expect(await dueFinancialTargets(client, "other", 10)).toEqual([]);
    expect(await dueFinancialTargets(client, target.source, 1)).toEqual([
      target,
    ]);
    expect(await dueFinancialTargets(client, target.source, 10)).toHaveLength(
      4,
    );
    await client.query("UPDATE route_plans SET archived_at=now()");
    expect(await dueFinancialTargets(client, target.source, 10)).toEqual([]);
    expect(
      (await readShipmentFinancials(f.db.pool, f.actor, shipmentId)).revision,
    ).toBe(3);
  } finally {
    client.release();
  }
});

it("promotes a pending observation on a later date and retains the provisional revision", async () => {
  const pending = financialObservation();
  pending.picking = {
    ...pending.picking,
    id: 2,
    partnerId: 2,
    state: "assigned",
    validatedAt: null,
  };
  pending.order.id = 2;
  pending.moves[0].pickingId = 2;
  pending.moves[0].state = "assigned";
  pending.moves[0].quantity = "0";
  pending.saleLines[0].delivered = "0";
  pending.relatedPickings = [pending.picking];
  const second = { ...target, pickingId: 2, orderId: 2, partnerId: 2 };
  await transaction(f.db.pool, (sql) =>
    persistFinancialSnapshot(
      sql,
      buildFinancialSnapshot(second, pending),
      60,
      10,
    ),
  );
  const done = structuredClone(pending);
  done.picking.state = "done";
  done.picking.validatedAt = "2026-10-01T14:00:00.000Z";
  done.picking.writeDate = done.picking.validatedAt;
  done.moves[0].state = "done";
  done.moves[0].quantity = "2";
  done.saleLines[0].delivered = "2";
  done.relatedPickings = [done.picking];
  expect(
    await transaction(f.db.pool, (sql) =>
      persistFinancialSnapshot(
        sql,
        buildFinancialSnapshot(second, done),
        60,
        10,
      ),
    ),
  ).toEqual({ changed: true, revision: 2 });
  const history = (
    await f.db.pool.query(
      "SELECT snapshot FROM route_financial_revisions WHERE picking_id=2 ORDER BY revision",
    )
  ).rows;
  expect(history[0].snapshot).toMatchObject({
    status: "pending_validation",
    shipmentAmounts: null,
  });
  expect(history[1].snapshot).toMatchObject({
    status: "ready",
    shipmentAmounts: { total: "20" },
  });
});

it("isolates a poisoned target across successful retries so healthy batches cannot starve", async () => {
  const client = await f.db.pool.connect();
  try {
    await client.query(
      "UPDATE route_plans SET archived_at=NULL; UPDATE route_financial_targets SET next_attempt_at='2000-01-01',failures=1",
    );
    expect(await dueFinancialTargets(client, target.source, 20)).toEqual([
      target,
    ]);
    await client.query(
      "UPDATE route_financial_targets SET next_attempt_at=now()+interval '1 hour' WHERE picking_id=1",
    );
    expect(
      (await dueFinancialTargets(client, target.source, 20)).map(
        (value) => value.pickingId,
      ),
    ).toEqual([2]);
    await client.query(
      "UPDATE route_financial_targets SET failures=0,next_attempt_at=now()+interval '1 minute' WHERE picking_id=2",
    );
    expect(
      (await dueFinancialTargets(client, target.source, 20)).map(
        (value) => value.pickingId,
      ),
    ).toEqual([3]);
    await client.query(
      "UPDATE route_financial_targets SET failures=0,next_attempt_at='2000-01-01' WHERE picking_id IN (2,3)",
    );
    expect(
      (await dueFinancialTargets(client, target.source, 20)).map(
        (value) => value.pickingId,
      ),
    ).toEqual([2, 3]);
    await client.query(
      "UPDATE route_financial_targets SET failures=0 WHERE picking_id=4",
    );
    expect(
      (await dueFinancialTargets(client, target.source, 20)).map(
        (value) => value.pickingId,
      ),
    ).toEqual([2, 3, 4]);
  } finally {
    client.release();
  }
});
