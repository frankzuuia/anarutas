import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "../src/core/auth";
import { departureMinute, saveDeparture } from "../src/core/departure";
import { createPlan, listPlans } from "../src/core/plans";
import { orderBoard } from "../src/core/orders";
import { startPostgres } from "./helpers/postgres";

describe("24-hour departure validation", () => {
  it.each([
    ["00:00", 0],
    ["07:30", 450],
    ["08:00", 480],
    ["11:00", 660],
    ["13:00", 780],
    ["23:59", 1439],
  ])("converts %s without AM/PM", (value, result) => {
    expect(departureMinute(value)).toBe(result);
  });
  it.each([
    null,
    undefined,
    450,
    "",
    "7:30",
    "24:00",
    "12:60",
    "11:00 AM",
    " 07:30",
    "-1:00",
    "aa:30",
    "07-30",
  ])("rejects invalid departure %s", (value) => {
    expect(() => departureMinute(value)).toThrow("ROUTING_DEPARTURE_INVALID");
  });
});

describe("departure persistence / real PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof startPostgres>>;
  let actor: string;
  beforeAll(async () => {
    db = await startPostgres();
    actor = (
      await bootstrap(db.pool, db.config, {
        token: db.config.bootstrapToken,
        name: "Salida QA",
        login: "departure-qa",
        password: randomUUID(),
      })
    ).id;
  });
  afterAll(async () => {
    await db?.close();
  });
  it("requires explicit selection, persists only on its plan, and handles concurrency and idempotence", async () => {
    const a = await createPlan(db.pool, actor, {
      date: "2026-09-10",
      label: "A",
    });
    const b = await createPlan(db.pool, actor, {
      date: "2026-09-11",
      label: "B",
    });
    expect(a.departure_minute).toBeNull();
    const results = await Promise.allSettled([
      saveDeparture(db.pool, actor, a.id, {
        expectedVersion: a.version,
        departureTime: "07:30",
      }),
      saveDeparture(db.pool, actor, a.id, {
        expectedVersion: a.version,
        departureTime: "08:00",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const current = (await orderBoard(db.pool, a.id)).plan;
    expect([450, 480]).toContain(current.departure_minute);
    expect((await orderBoard(db.pool, b.id)).plan.departure_minute).toBeNull();
    const time = current.departure_minute === 450 ? "07:30" : "08:00";
    expect(
      (
        await saveDeparture(db.pool, actor, a.id, {
          expectedVersion: current.version,
          departureTime: time,
        })
      ).version,
    ).toBe(current.version);
    expect(
      (await listPlans(db.pool)).find((plan) => plan.id === a.id)
        ?.departure_minute,
    ).toBe(current.departure_minute);
    await expect(
      saveDeparture(db.pool, randomUUID(), a.id, {
        expectedVersion: current.version,
        departureTime: "08:00",
      }),
    ).rejects.toThrow("UNAUTHENTICATED");
    await expect(
      saveDeparture(db.pool, actor, randomUUID(), {
        expectedVersion: 1,
        departureTime: "08:00",
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM route_audit WHERE action='plan.departure.updated' AND entity_id=$1",
          [a.id],
        )
      ).rows[0].count,
    ).toBe(1);
  });
});
