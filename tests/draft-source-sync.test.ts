import { afterAll, beforeAll, expect, it } from "vitest";
import {
  lockDraftSourcePlans,
  refreshDraftSourceShipments,
} from "../src/core/draft-source-sync";
import {
  buildFinancialSnapshot,
  financialHash,
} from "../src/core/financial-policy";
import { financialObservation } from "./helpers/financial";
import { executionFixture } from "./helpers/driver-execution";
import { createPlan } from "../src/core/plans";
import { persistImportPage, orderBoard } from "../src/core/orders";
import { transaction } from "../src/core/database";
import type { FinancialSnapshot } from "../src/core/financial-contract";

let f: Awaited<ReturnType<typeof executionFixture>>,
  snapshots: FinancialSnapshot[],
  draftPlanId: string;
beforeAll(async () => {
  f = await executionFixture();
  await f.start();
  const rows = (
    await f.db.pool.query(
      "SELECT snapshot,source FROM route_shipments ORDER BY picking_id",
    )
  ).rows;
  const plan = await createPlan(f.db.pool, f.actor, {
    date: "2026-09-30",
    label: "Borrador sincronizado",
  });
  draftPlanId = plan.id;
  await persistImportPage(f.db.pool, f.actor, plan.id, {
    fingerprint: rows[0].source,
    shipments: rows.map((r) => r.snapshot),
    nextCursor: 4,
    ceiling: 4,
    hasMore: false,
    inspected: 4,
    excluded: 0,
  });
  snapshots = rows.map((row, index) => {
    const observation = financialObservation(),
      id = index + 1;
    observation.picking.id = id;
    observation.picking.partnerId = row.snapshot.partnerId;
    observation.order.id = id;
    observation.moves[0].id = id;
    observation.moves[0].pickingId = id;
    observation.moves[0].productId = id;
    observation.moves[0].quantity = "3.2";
    observation.saleLines[0].productId = id;
    observation.relatedPickings = [observation.picking];
    return buildFinancialSnapshot(
      {
        source: row.source,
        pickingId: id,
        orderId: id,
        partnerId: row.snapshot.partnerId,
      },
      observation,
    );
  });
}, 120_000);
afterAll(async () => {
  await f?.close();
});
const refresh = () =>
  transaction(f.db.pool, async (sql) => {
    const plans = await lockDraftSourcePlans(sql, snapshots);
    return refreshDraftSourceShipments(sql, snapshots, plans);
  });
it("holds real plan locks before updating source targets so publication and source cannot cross", async () => {
  const concurrent = await f.db.pool.connect();
  try {
    await transaction(f.db.pool, async (sql) => {
      expect(await lockDraftSourcePlans(sql, snapshots)).toContain(f.planId);
      await expect(
        concurrent.query(
          "SELECT id FROM route_plans WHERE id=$1 FOR UPDATE NOWAIT",
          [f.planId],
        ),
      ).rejects.toMatchObject({ code: "55P03" });
    });
  } finally {
    concurrent.release();
  }
});
it("updates all mutable drafts automatically, preserves started lanes/publications/assignments, versions once and emits an audit", async () => {
  const before = await orderBoard(f.db.pool, f.planId);
  const frozen = (
    await f.db.pool.query(
      "SELECT * FROM route_plan_publications ORDER BY vehicle_id",
    )
  ).rows;
  const draft = await orderBoard(f.db.pool, draftPlanId);
  expect(await refresh()).toBe(5);
  const after = await orderBoard(f.db.pool, f.planId),
    updated = await orderBoard(f.db.pool, draftPlanId);
  expect(after.shipments.slice(0, 3)).toEqual(before.shipments.slice(0, 3));
  expect(after.shipments[3].lines[0].quantity).toBe(3.2);
  expect(
    updated.shipments.every(
      (s) => s.lines[0].quantity === 3.2 && s.fulfillmentStatus === "validated",
    ),
  ).toBe(true);
  expect(
    updated.shipments.map((s) => [
      s.id,
      s.vehicle_id,
      s.position,
      s.window_start,
    ]),
  ).toEqual(
    draft.shipments.map((s) => [
      s.id,
      s.vehicle_id,
      s.position,
      s.window_start,
    ]),
  );
  expect(updated.plan.version).toBe(draft.plan.version + 1);
  expect(
    (
      await f.db.pool.query(
        "SELECT * FROM route_plan_publications ORDER BY vehicle_id",
      )
    ).rows,
  ).toEqual(frozen);
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM route_audit WHERE action='orders.source_refreshed'",
      )
    ).rows[0].n,
  ).toBe(2);
  await expect(f.start(f.members[1])).rejects.toMatchObject({
    code: "ROUTE_PUBLICATION_CHANGED",
  });
});
it("no-op/concurrent repeated observations do not bump versions; rollback and archiving preserve last good draft", async () => {
  const before = await orderBoard(f.db.pool, draftPlanId);
  expect(await Promise.all([refresh(), refresh()])).toEqual([0, 0]);
  expect((await orderBoard(f.db.pool, draftPlanId)).plan.version).toBe(
    before.plan.version,
  );
  await expect(
    transaction(f.db.pool, async (sql) => {
      const modified = structuredClone(snapshots);
      modified[0].observation.moves[0].quantity = "6";
      await refreshDraftSourceShipments(
        sql,
        modified,
        await lockDraftSourcePlans(sql, modified),
      );
      throw new Error("Rollback de sincronización");
    }),
  ).rejects.toThrow("Rollback de sincronización");
  expect(
    financialHash((await orderBoard(f.db.pool, draftPlanId)).shipments),
  ).toBe(financialHash(before.shipments));
  await f.db.pool.query(
    "UPDATE route_plans SET archived_at=now() WHERE id=$1",
    [draftPlanId],
  );
  snapshots[0].observation.moves[0].quantity = "7";
  expect(await refresh()).toBe(0);
  expect(
    (await orderBoard(f.db.pool, draftPlanId)).shipments[0].lines[0].quantity,
  ).toBe(3.2);
});
