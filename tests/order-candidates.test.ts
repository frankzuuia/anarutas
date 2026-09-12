import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { startPostgres } from "./helpers/postgres";
import { bootstrap, createUser } from "../src/core/auth";
import { createPlan } from "../src/core/plans";
import { createVehicle } from "../src/core/fleet";
import { orderBoard, moveShipment } from "../src/core/orders";
import {
  candidateHash,
  createCandidateBatch,
  prepareConfirmation,
  persistCandidateSelection,
} from "../src/core/order-candidates";
import { localShipment } from "./helpers/candidate";

let db: Awaited<ReturnType<typeof startPostgres>>,
  actor: string,
  vehicle: string;
let day = 12;
const source = candidateHash("local-domain-contract"),
  observation = { requestId: randomUUID(), odooMs: 1 };
beforeAll(async () => {
  db = await startPostgres();
  actor = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "QA selección",
      login: "qa-selection",
      password: randomUUID(),
    })
  ).id;
  vehicle = (
    await createVehicle(db.pool, actor, {
      id: randomUUID(),
      name: "QA",
      brand: "QA",
      model: "QA",
      plate: randomUUID().slice(0, 8),
      mileage: 0,
      fuel: "Gasolina",
      available: true,
    })
  ).id;
});
afterAll(async () => {
  await db?.close();
});
async function setup() {
  const plan = await createPlan(db.pool, actor, {
    date: `2026-09-${day++}`,
    label: "QA selección",
  });
  const input = {
    date: "2026-09-11",
    vehicleIds: [vehicle],
    expectedVersion: plan.version,
  };
  const items = [localShipment(1), localShipment(2), localShipment(3)];
  const before = await orderBoard(db.pool, plan.id);
  const batch = await createCandidateBatch(
    db.pool,
    actor,
    plan.id,
    input,
    "America/Mexico_City",
    source,
    items,
    observation,
  );
  expect(await orderBoard(db.pool, plan.id)).toEqual(before);
  return {
    plan,
    input,
    items,
    batch,
    confirm: {
      batchId: batch.batchId,
      expectedVersion: plan.version,
      vehicleIds: [vehicle],
      selection: {
        mode: "explicit",
        ids: [batch.candidates[0].candidateId, batch.candidates[2].candidateId],
      },
    },
  };
}
it("query leaves plan untouched; exact selection atomically saves and concurrent retries reuse receipt", async () => {
  const { plan, items, confirm } = await setup();
  const chosen = [items[0], items[2]];
  const results = await Promise.all(
    [1, 2].map(() =>
      persistCandidateSelection(
        db.pool,
        actor,
        plan.id,
        source,
        confirm,
        chosen,
        observation,
      ),
    ),
  );
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({
    selected: 2,
    inserted: 2,
    pending: 2,
    version: 2,
  });
  const board = await orderBoard(db.pool, plan.id);
  expect(board.shipments.map((s) => s.orderId)).toEqual([1, 3]);
  expect(board.vehicles).toHaveLength(1);
  expect(
    (await prepareConfirmation(db.pool, actor, plan.id, source, confirm))
      .receipt,
  ).toEqual(results[0]);
  await expect(
    prepareConfirmation(db.pool, actor, plan.id, source, {
      ...confirm,
      selection: { mode: "all_except", ids: [] },
    }),
  ).rejects.toThrow("CANDIDATE_BATCH_CONSUMED");
  expect(
    Number(
      (
        await db.pool.query(
          "SELECT count(*) n FROM route_audit WHERE action='orders.selection.confirmed' AND entity_id=$1",
          [plan.id],
        )
      ).rows[0].n,
    ),
  ).toBe(1);
});
it("rejects incomplete/cancelled/invalid/reassigned selections without even saving vehicles", async () => {
  const { plan, items, confirm } = await setup();
  const before = await orderBoard(db.pool, plan.id);
  for (const fresh of [
    [],
    [items[0]],
    [items[0], { ...items[2], partnerId: 88 }],
    [items[0], { ...items[2], odooPickingState: "cancel" }],
    [items[0], { ...items[2], scheduledAt: null }],
    [items[0], { ...items[2], lines: [] }],
    [items[0], { ...items[2], lines: [{ ...items[2].lines[0], quantity: 0 }] }],
  ]) {
    await expect(
      persistCandidateSelection(
        db.pool,
        actor,
        plan.id,
        source,
        confirm,
        fresh,
        observation,
      ),
    ).rejects.toThrow("CANDIDATE_CHANGED");
    expect(await orderBoard(db.pool, plan.id)).toEqual(before);
  }
});
it("actor/plan/source/ids/expiration/version are enforced; no cross-plan duplicate restriction", async () => {
  const a = await setup(),
    b = await setup();
  const other = (
    await createUser(db.pool, actor, {
      name: "Otro QA",
      login: randomUUID(),
      password: randomUUID(),
    })
  ).id;
  for (const args of [
    [other, a.plan.id, source],
    [actor, b.plan.id, source],
    [actor, a.plan.id, candidateHash("other")],
  ])
    await expect(
      prepareConfirmation(db.pool, args[0], args[1], args[2], a.confirm),
    ).rejects.toThrow("CANDIDATE_BATCH_INVALID");
  await expect(
    prepareConfirmation(db.pool, actor, a.plan.id, source, {
      ...a.confirm,
      selection: { mode: "explicit", ids: [randomUUID()] },
    }),
  ).rejects.toThrow("CANDIDATE_INVALID");
  await expect(
    prepareConfirmation(db.pool, actor, a.plan.id, source, {
      ...a.confirm,
      expectedVersion: 2,
    }),
  ).rejects.toThrow("VERSION_CONFLICT");
  await expect(
    prepareConfirmation(db.pool, actor, a.plan.id, source, {
      ...a.confirm,
      vehicleIds: [],
    }),
  ).rejects.toThrow("CANDIDATE_BATCH_INVALID");
  await persistCandidateSelection(
    db.pool,
    actor,
    a.plan.id,
    source,
    a.confirm,
    [a.items[0], a.items[2]],
    observation,
  );
  await persistCandidateSelection(
    db.pool,
    actor,
    b.plan.id,
    source,
    b.confirm,
    [b.items[0], b.items[2]],
    observation,
  );
  expect((await orderBoard(db.pool, b.plan.id)).shipments).toHaveLength(2);
  const c = await setup();
  await db.pool.query(
    "UPDATE route_order_batches SET expires_at=now()-interval '1 second' WHERE id=$1",
    [c.batch.batchId],
  );
  await expect(
    prepareConfirmation(db.pool, actor, c.plan.id, source, c.confirm),
  ).rejects.toThrow("CANDIDATE_BATCH_EXPIRED");
  await expect(
    persistCandidateSelection(
      db.pool,
      actor,
      c.plan.id,
      source,
      c.confirm,
      c.items,
      observation,
    ),
  ).rejects.toThrow("CANDIDATE_BATCH_EXPIRED");
});
it("pending→validated keeps shipment ID, position and assignment; hash ignores JSONB key order", async () => {
  const { plan, items, confirm } = await setup();
  await persistCandidateSelection(
    db.pool,
    actor,
    plan.id,
    source,
    confirm,
    [items[0], items[2]],
    observation,
  );
  let board = await orderBoard(db.pool, plan.id);
  const first = board.shipments[0];
  await moveShipment(db.pool, actor, plan.id, {
    shipmentId: first.id,
    vehicleId: vehicle,
    expectedVersion: board.plan.version,
  });
  board = await orderBoard(db.pool, plan.id);
  const input = {
    date: "2026-09-11",
    vehicleIds: [vehicle],
    expectedVersion: board.plan.version,
  };
  const batch = await createCandidateBatch(
    db.pool,
    actor,
    plan.id,
    input,
    "America/Mexico_City",
    source,
    items,
    observation,
  );
  const request = {
    ...input,
    batchId: batch.batchId,
    selection: { mode: "explicit", ids: [batch.candidates[0].candidateId] },
  };
  const done = {
    ...items[0],
    fulfillmentStatus: "validated" as const,
    odooPickingState: "done",
    validatedAt: items[0].scheduledAt,
  };
  expect(
    (
      await persistCandidateSelection(
        db.pool,
        actor,
        plan.id,
        source,
        request,
        [done],
        observation,
      )
    ).updated,
  ).toBe(1);
  const current = (await orderBoard(db.pool, plan.id)).shipments.find(
    (s) => s.id === first.id,
  )!;
  expect(current).toMatchObject({
    id: first.id,
    vehicle_id: vehicle,
    fulfillmentStatus: "validated",
    position: board.shipments.find((s) => s.id === first.id)!.position,
  });
  expect(candidateHash({ a: 1, b: 2 })).toBe(candidateHash({ b: 2, a: 1 }));
});
it("SQL failure rolls back vehicles, shipments, version and receipt", async () => {
  const { plan, items, confirm } = await setup();
  await db.pool.query(
    "ALTER TABLE route_shipments ADD CONSTRAINT qa_selection_rejection CHECK(order_id<>3) NOT VALID",
  );
  try {
    await expect(
      persistCandidateSelection(
        db.pool,
        actor,
        plan.id,
        source,
        confirm,
        [items[0], items[2]],
        observation,
      ),
    ).rejects.toThrow();
  } finally {
    await db.pool.query(
      "ALTER TABLE route_shipments DROP CONSTRAINT qa_selection_rejection",
    );
  }
  const board = await orderBoard(db.pool, plan.id);
  expect(board.plan.version).toBe(1);
  expect(board.vehicles).toHaveLength(0);
  expect(board.shipments).toHaveLength(0);
  expect(
    (await prepareConfirmation(db.pool, actor, plan.id, source, confirm))
      .receipt,
  ).toBeNull();
});
it("enforces the locked version, exact fleet and consumed request inside persistence", async () => {
  const changedPlan = await setup();
  await db.pool.query("UPDATE route_plans SET version=version+1 WHERE id=$1", [
    changedPlan.plan.id,
  ]);
  await expect(
    prepareConfirmation(
      db.pool,
      actor,
      changedPlan.plan.id,
      source,
      changedPlan.confirm,
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    persistCandidateSelection(
      db.pool,
      actor,
      changedPlan.plan.id,
      source,
      changedPlan.confirm,
      [changedPlan.items[0], changedPlan.items[2]],
      observation,
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

  const changedBatch = await setup();
  await db.pool.query(
    "UPDATE route_order_batches SET plan_version=plan_version+1 WHERE id=$1",
    [changedBatch.batch.batchId],
  );
  await expect(
    persistCandidateSelection(
      db.pool,
      actor,
      changedBatch.plan.id,
      source,
      changedBatch.confirm,
      [changedBatch.items[0], changedBatch.items[2]],
      observation,
    ),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

  const changedFleet = await setup();
  const otherVehicle = (
    await createVehicle(db.pool, actor, {
      id: randomUUID(),
      name: "Otra QA",
      brand: "QA",
      model: "QA",
      plate: randomUUID().slice(0, 8),
      mileage: 0,
      fuel: "Gasolina",
      available: true,
    })
  ).id;
  await expect(
    persistCandidateSelection(
      db.pool,
      actor,
      changedFleet.plan.id,
      source,
      { ...changedFleet.confirm, vehicleIds: [otherVehicle] },
      [changedFleet.items[0], changedFleet.items[2]],
      observation,
    ),
  ).rejects.toMatchObject({ code: "CANDIDATE_BATCH_INVALID" });

  const consumed = await setup();
  await persistCandidateSelection(
    db.pool,
    actor,
    consumed.plan.id,
    source,
    consumed.confirm,
    [consumed.items[0], consumed.items[2]],
    observation,
  );
  await expect(
    persistCandidateSelection(
      db.pool,
      actor,
      consumed.plan.id,
      source,
      {
        ...consumed.confirm,
        selection: { mode: "all_except", ids: [] },
      },
      consumed.items,
      observation,
    ),
  ).rejects.toMatchObject({ code: "CANDIDATE_BATCH_CONSUMED" });
});
it("revalidates status, every line, regressions and exact fresh result", async () => {
  const accepted = await setup();
  const confirmed = {
    ...accepted.items[0],
    odooPickingState: "confirmed",
  };
  expect(
    await persistCandidateSelection(
      db.pool,
      actor,
      accepted.plan.id,
      source,
      accepted.confirm,
      [confirmed, accepted.items[2]],
      observation,
    ),
  ).toMatchObject({ inserted: 2 });

  for (const change of [
    {
      ...localShipment(1),
      lines: [
        ...localShipment(1).lines,
        { ...localShipment(1).lines[0], moveId: 999, quantity: 0 },
      ],
    },
    {
      ...localShipment(1),
      odooPickingState: "done",
      fulfillmentStatus: "pending_validation" as const,
      validatedAt: localShipment(1).scheduledAt,
    },
    {
      ...localShipment(1),
      odooPickingState: "assigned",
      fulfillmentStatus: "validated" as const,
      validatedAt: localShipment(1).scheduledAt,
    },
  ]) {
    const current = await setup();
    await expect(
      persistCandidateSelection(
        db.pool,
        actor,
        current.plan.id,
        source,
        current.confirm,
        [change, current.items[2]],
        observation,
      ),
    ).rejects.toMatchObject({ code: "CANDIDATE_CHANGED" });
  }

  const extra = await setup();
  await expect(
    persistCandidateSelection(
      db.pool,
      actor,
      extra.plan.id,
      source,
      extra.confirm,
      extra.items,
      observation,
    ),
  ).rejects.toMatchObject({ code: "CANDIDATE_CHANGED" });

  const regression = await setup();
  const validated = {
    ...regression.items[0],
    odooPickingState: "done",
    fulfillmentStatus: "validated" as const,
    validatedAt: regression.items[0].scheduledAt,
  };
  const validatedBatch = await createCandidateBatch(
    db.pool,
    actor,
    regression.plan.id,
    regression.input,
    "America/Mexico_City",
    source,
    [validated],
    observation,
  );
  const request = {
    ...regression.input,
    batchId: validatedBatch.batchId,
    selection: {
      mode: "explicit" as const,
      ids: [validatedBatch.candidates[0].candidateId],
    },
  };
  await expect(
    persistCandidateSelection(
      db.pool,
      actor,
      regression.plan.id,
      source,
      request,
      [regression.items[0]],
      observation,
    ),
  ).rejects.toMatchObject({ code: "CANDIDATE_CHANGED" });
});
it("all-except persists globally and an unchanged existing shipment is not updated", async () => {
  const first = await setup();
  const request = {
    ...first.input,
    batchId: first.batch.batchId,
    selection: {
      mode: "all_except" as const,
      ids: [first.batch.candidates[1].candidateId],
    },
  };
  expect(
    await persistCandidateSelection(
      db.pool,
      actor,
      first.plan.id,
      source,
      request,
      [first.items[0], first.items[2]],
      observation,
    ),
  ).toMatchObject({ selected: 2, inserted: 2 });

  const board = await orderBoard(db.pool, first.plan.id);
  const nextInput = {
    date: "2026-09-11",
    vehicleIds: [vehicle],
    expectedVersion: board.plan.version,
  };
  const nextBatch = await createCandidateBatch(
    db.pool,
    actor,
    first.plan.id,
    nextInput,
    "America/Mexico_City",
    source,
    [first.items[0]],
    observation,
  );
  const unchanged = await persistCandidateSelection(
    db.pool,
    actor,
    first.plan.id,
    source,
    {
      ...nextInput,
      batchId: nextBatch.batchId,
      selection: {
        mode: "explicit",
        ids: [nextBatch.candidates[0].candidateId],
      },
    },
    [first.items[0]],
    observation,
  );
  expect(unchanged).toMatchObject({ existing: 1, updated: 0, inserted: 0 });
});
