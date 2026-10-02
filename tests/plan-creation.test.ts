import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startPostgres } from "./helpers/postgres";
import { bootstrap, createUser, setUserActive } from "../src/core/auth";
import { createPlan, deletePlan, editPlan, listPlans } from "../src/core/plans";

let db: Awaited<ReturnType<typeof startPostgres>>;
let actor: string;
beforeAll(async () => {
  db = await startPostgres();
  actor = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "Creación QA",
      login: "creation-qa",
      password: randomUUID(),
    })
  ).id;
});
afterAll(async () => {
  await db?.close();
});
const input = () => ({
  date: "2026-10-01",
  label: "Otra salida",
  commandId: randomUUID(),
});

it("creates independent empty drafts for two intentions on the same date and label", async () => {
  const one = await createPlan(db.pool, actor, input());
  const two = await createPlan(db.pool, actor, input());
  expect(two.id).not.toBe(one.id);
  expect(two.service_date).toBe(one.service_date);
  expect(two.label).toBe(one.label);
  for (const table of [
    "route_shipments",
    "route_plan_vehicles",
    "route_plan_publications",
  ])
    expect(
      (await db.pool.query(`SELECT 1 FROM ${table} WHERE plan_id=$1`, [two.id]))
        .rowCount,
    ).toBe(0);
});

it("creates separate drafts for legacy callers without a command key", async () => {
  const values = { date: "2026-10-02", label: "Legacy" };
  const one = await createPlan(db.pool, actor, values);
  expect((await createPlan(db.pool, actor, values)).id).not.toBe(one.id);
});

it("serializes exact concurrent retries into one plan and one audit", async () => {
  const values = input();
  const plans = await Promise.all(
    Array.from({ length: 8 }, () => createPlan(db.pool, actor, values)),
  );
  expect(new Set(plans.map((p) => p.id)).size).toBe(1);
  expect(
    (
      await db.pool.query(
        "SELECT 1 FROM route_audit WHERE action='plan.created' AND entity_id=$1",
        [plans[0].id],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await db.pool.query(
        "SELECT plan_id FROM route_plan_creation_requests WHERE actor_id=$1 AND command_id=$2",
        [actor, values.commandId],
      )
    ).rows,
  ).toEqual([{ plan_id: plans[0].id }]);
});

it("keeps distinct concurrent creation intentions separate", async () => {
  const plans = await Promise.all(
    Array.from({ length: 6 }, () => createPlan(db.pool, actor, input())),
  );
  expect(new Set(plans.map((p) => p.id)).size).toBe(6);
});

it("normalizes UUID aliases before acquiring the concurrent request lock", async () => {
  const values = input();
  const [lower, upper] = await Promise.all([
    createPlan(db.pool, actor, values),
    createPlan(db.pool, actor, {
      ...values,
      commandId: values.commandId.toUpperCase(),
    }),
  ]);
  expect(upper.id).toBe(lower.id);
});

it("rejects a reused key with different content and preserves the original request", async () => {
  const values = input();
  const plan = await createPlan(db.pool, actor, values);
  for (const change of [{ label: "Cambio" }, { date: "2026-10-03" }])
    await expect(
      createPlan(db.pool, actor, { ...values, ...change }),
    ).rejects.toMatchObject({ code: "PLAN_CREATION_REUSED", status: 409 });
  expect((await createPlan(db.pool, actor, values)).id).toBe(plan.id);
  expect((await listPlans(db.pool)).find((p) => p.id === plan.id)?.label).toBe(
    values.label,
  );
});

it("replays against the initial request after editing the plan", async () => {
  const values = input();
  const plan = await createPlan(db.pool, actor, values);
  await editPlan(db.pool, actor, plan.id, {
    expectedVersion: 1,
    label: "Renombrado",
  });
  const replay = await createPlan(db.pool, actor, values);
  expect(replay).toMatchObject({
    id: plan.id,
    label: "Renombrado",
    version: 2,
  });
});

it("does not resurrect a deleted draft on a delayed retry", async () => {
  const values = input();
  const plan = await createPlan(db.pool, actor, values);
  await deletePlan(db.pool, actor, plan.id, { expectedVersion: 1 });
  await expect(createPlan(db.pool, actor, values)).rejects.toMatchObject({
    code: "PLAN_CREATION_REMOVED",
    status: 409,
  });
  expect(
    (await db.pool.query("SELECT 1 FROM route_plans WHERE id=$1", [plan.id]))
      .rowCount,
  ).toBe(0);
});

it("does not alter a creation intent when deletion targets a missing plan or stale version", async () => {
  const values = input();
  const plan = await createPlan(db.pool, actor, values);
  await expect(
    deletePlan(db.pool, actor, randomUUID(), { expectedVersion: 1 }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    deletePlan(db.pool, actor, plan.id, { expectedVersion: 2 }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  expect((await createPlan(db.pool, actor, values)).id).toBe(plan.id);
});

it("scopes command keys to their authenticated creator", async () => {
  const another = (
    await createUser(db.pool, actor, {
      name: "Otro admin",
      login: "another-creator",
      password: randomUUID(),
    })
  ).id;
  const values = input();
  const one = await createPlan(db.pool, actor, values);
  const two = await createPlan(db.pool, another, values);
  expect(two.id).not.toBe(one.id);
  expect((await createPlan(db.pool, another, values)).id).toBe(two.id);
});

it("denies inactive, missing and settlement actors even when replaying", async () => {
  const account = await createUser(db.pool, actor, {
    name: "Inactivo",
    login: "inactive-creator",
    password: randomUUID(),
  });
  const receiver = await createUser(db.pool, actor, {
    name: "Receptor",
    login: "receiver-creator",
    password: randomUUID(),
    role: "settlement",
  });
  const values = input();
  await createPlan(db.pool, account.id, values);
  await setUserActive(db.pool, actor, account.id, false);
  await expect(createPlan(db.pool, account.id, values)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  await expect(createPlan(db.pool, randomUUID(), values)).rejects.toMatchObject(
    { code: "UNAUTHENTICATED" },
  );
  await expect(createPlan(db.pool, receiver.id, values)).rejects.toMatchObject({
    code: "ROLE_DENIED",
  });
});

it("rejects invalid dates, names and command keys before writing", async () => {
  const count = async () =>
    (await db.pool.query("SELECT count(*)::int AS n FROM route_plans")).rows[0]
      .n;
  const before = await count();
  for (const change of [
    { date: "2026-02-30" },
    { date: "2026-99-99" },
    { label: "" },
    { label: "x".repeat(121) },
    { commandId: "bad" },
    { commandId: null },
    { commandId: 4 },
    { commandId: "zzzzzzzz-0000-0000-0000-000000000000" },
  ])
    await expect(
      createPlan(db.pool, actor, { ...input(), ...change }),
    ).rejects.toThrow();
  expect(await count()).toBe(before);
});

it("binds hostile labels as data and rolls back creation when its audit fails", async () => {
  const values = { ...input(), label: "'); DROP TABLE route_plans; --" };
  expect((await createPlan(db.pool, actor, values)).label).toBe(values.label);
  const retry = input();
  const before = (
    await db.pool.query("SELECT count(*)::int AS n FROM route_plans")
  ).rows[0].n;
  await db.pool
    .query(`CREATE FUNCTION qa_abort_plan_creation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='plan.created' THEN RAISE EXCEPTION 'qa-plan-audit-abort'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER qa_abort_plan_creation BEFORE INSERT ON route_audit FOR EACH ROW EXECUTE FUNCTION qa_abort_plan_creation()`);
  try {
    await expect(createPlan(db.pool, actor, retry)).rejects.toThrow(
      "qa-plan-audit-abort",
    );
    expect(
      (await db.pool.query("SELECT count(*)::int AS n FROM route_plans"))
        .rows[0].n,
    ).toBe(before);
    expect(
      (
        await db.pool.query(
          "SELECT 1 FROM route_plan_creation_requests WHERE actor_id=$1 AND command_id=$2",
          [actor, retry.commandId],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await db.pool.query(
      "DROP TRIGGER qa_abort_plan_creation ON route_audit; DROP FUNCTION qa_abort_plan_creation()",
    );
  }
  expect((await createPlan(db.pool, actor, retry)).id).toBeTruthy();
});

it("lists the latest operation first with deterministic creation and UUID ties", async () => {
  const values = { date: "2027-01-01", label: "Orden" };
  const plans = await Promise.all(
    Array.from({ length: 3 }, () =>
      createPlan(db.pool, actor, { ...values, commandId: randomUUID() }),
    ),
  );
  await db.pool.query(
    "UPDATE route_plans SET created_at='2026-10-01T12:00:00Z' WHERE id=ANY($1::uuid[])",
    [plans.map((p) => p.id)],
  );
  const older = await createPlan(db.pool, actor, {
    ...values,
    date: "2026-12-31",
    commandId: randomUUID(),
  });
  const sorted = await listPlans(db.pool);
  expect(sorted.slice(0, 3).map((p) => p.id)).toEqual(
    plans
      .map((p) => p.id)
      .sort()
      .reverse(),
  );
  expect(sorted[3].id).toBe(older.id);
});
