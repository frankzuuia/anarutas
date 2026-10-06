import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { readDriverExecution } from "../src/core/driver-execution-read";
import {
  executeStopCommand,
  exitDriverVisit,
} from "../src/core/driver-stop-command";
import { executeDriverOrderCommand } from "../src/core/driver-order-command";
import { reportCustomerClosed } from "../src/core/driver-closed-command";
import { completeDriverRoute } from "../src/core/driver-route-completion";
import { readDriverPlan } from "../src/core/driver-mobile-route";
import { readDriverCommandResult } from "../src/core/driver-command-receipts";
import { saveRoutingSettings } from "../src/core/routing-settings";
import { migrate } from "../src/core/database";
import { writeLiveTracking } from "../src/core/live-tracking";
import { readLiveRoutes } from "../src/core/live-routes";
import { retryDriverOrder } from "../src/core/driver-order-retry";

type Fixture = Awaited<ReturnType<typeof executionFixture>>;
const sample = (f: Fixture) => ({
  latitude: 20.64,
  longitude: -103.4,
  accuracyMeters: 5,
  ageMilliseconds: 0,
  capturedAt: f.now.toISOString(),
  mock: false,
});
const state = (f: Fixture) =>
  readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
async function identity(f: Fixture, index = 0) {
  const route = await state(f),
    stop = route.stops[index];
  return {
    commandId: randomUUID(),
    executionId: route.id,
    publicationRevision: route.publicationRevision,
    executionRevision: route.revision,
    stopVersion: stop.version,
    visitSequence: stop.visitSequence,
    policyVersion: route.policy.version,
  };
}
async function arrive(f: Fixture, index: number) {
  const stop = (await state(f)).stops[index];
  return executeStopCommand(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stop.id,
    "arrival",
    { ...(await identity(f, index)), sample: sample(f) },
    f.timezone,
    f.now,
  );
}
async function service(f: Fixture, index: number, kind: string) {
  const stop = (await state(f)).stops[index],
    order = stop.orderStates[0];
  return executeDriverOrderCommand(
    f.db.pool,
    f.members[0].authorization,
    f.planId,
    stop.id,
    order.shipmentId,
    { ...(await identity(f, index)), orderVersion: order.version, kind },
    f.timezone,
    f.now,
  );
}
async function finishInput(f: Fixture) {
  const route = await state(f),
    plan = await readDriverPlan(
      f.db.pool,
      f.members[0].driverId,
      f.planId,
      f.timezone,
    );
  return {
    commandId: randomUUID(),
    executionId: route.id,
    publicationRevision: route.publicationRevision,
    executionRevision: route.revision,
    policyVersion: route.policy.version,
    depotVersion: plan.departure!.version,
    confirmed: true,
    sample: sample(f),
  };
}
async function depot(f: Fixture) {
  await saveRoutingSettings(f.db.pool, f.actor, {
    expectedVersion: 0,
    depotAddress: "Bodega QA",
    depotLocation: { latitude: 20.64, longitude: -103.4, placeId: "qa-depot" },
    departureTime: "08:00",
    serviceMinutes: 10,
  });
}

it("finishes atomically in the depot, recovers lost replies and freezes driver writes without erasing history", async () => {
  const f = await executionFixture();
  try {
    await f.start();
    const withoutDepot = await state(f);
    await expect(
      completeDriverRoute(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        {
          commandId: randomUUID(),
          executionId: withoutDepot.id,
          publicationRevision: 1,
          executionRevision: withoutDepot.revision,
          policyVersion: withoutDepot.policy.version,
          depotVersion: 1,
          confirmed: true,
          sample: sample(f),
        },
        f.now,
      ),
    ).rejects.toMatchObject({ code: "ROUTING_ORIGIN_REQUIRED" });
    await depot(f);
    const unfinished = await finishInput(f);
    const run = (
      input = unfinished,
      auth = f.members[0].authorization,
      now = f.now,
    ) => completeDriverRoute(f.db.pool, auth, f.planId, input, now);
    await expect(run()).rejects.toMatchObject({
      code: "ROUTE_HAS_PENDING_ORDERS",
    });
    for (let index = 0; index < 3; index++) {
      await arrive(f, index);
      await service(f, index, "deliver");
    }
    const input = await finishInput(f),
      before = await state(f);
    const tracking = {
      kind: "begin",
      executionId: before.id,
      publicationRevision: before.publicationRevision,
      sessionId: randomUUID(),
    };
    await writeLiveTracking(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      tracking,
    );
    await writeLiveTracking(f.db.pool, f.members[0].authorization, f.planId, {
      ...tracking,
      kind: "sample",
      sequence: 1,
      targetStopId: null,
      destination: { kind: "warehouse", depotVersion: input.depotVersion },
      sample: null,
    });
    const publication = (
      await f.db.pool.query(
        "SELECT snapshot,snapshot_hash,revision FROM route_plan_publications ORDER BY vehicle_id",
      )
    ).rows;
    await expect(run(input, "Bearer invalid")).rejects.toMatchObject({
      status: 401,
    });
    await expect(run(input, f.members[1].authorization)).rejects.toMatchObject({
      status: 404,
    });
    for (const key of [
      "executionRevision",
      "publicationRevision",
      "depotVersion",
      "policyVersion",
    ])
      await expect(run({ ...input, [key]: 999 })).rejects.toMatchObject({
        status: 409,
      });
    await expect(
      run({ ...input, executionId: randomUUID() }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      completeDriverRoute(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        input,
      ),
    ).rejects.toMatchObject({ code: "LOCATION_STALE" });
    for (const [change, code] of [
      [{ latitude: 21 }, "OUTSIDE_ARRIVAL_RADIUS"],
      [{ accuracyMeters: 999 }, "LOCATION_IMPRECISE"],
      [{ ageMilliseconds: 999999 }, "LOCATION_STALE"],
      [{ mock: true }, "LOCATION_UNTRUSTED"],
    ] as const)
      await expect(
        run({ ...input, sample: { ...input.sample, ...change } }),
      ).rejects.toMatchObject({ code });
    const [first, replay] = await Promise.all([run(input), run(input)]);
    expect([first.duplicate, replay.duplicate].sort()).toEqual([false, true]);
    expect(first.completedAt).toBe(f.now.toISOString());
    expect(
      (
        await run(
          input,
          f.members[0].authorization,
          new Date(f.now.getTime() + 600000),
        )
      ).duplicate,
    ).toBe(true);
    await expect(
      run({ ...input, commandId: randomUUID() }),
    ).rejects.toMatchObject({ code: "ROUTE_COMPLETED" });
    await expect(run({ ...input, confirmed: false })).rejects.toMatchObject({
      code: "ROUTE_COMPLETION_CONFIRMATION_REQUIRED",
    });
    await expect(
      run({ ...input, sample: { ...input.sample, latitude: 20 } }),
    ).rejects.toMatchObject({ code: "COMMAND_REUSED" });
    expect(
      await readDriverCommandResult(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        input.commandId,
      ),
    ).toMatchObject({
      confirmed: true,
      result: { completedAt: f.now.toISOString() },
    });
    const after = await state(f);
    expect(after).toMatchObject({
      completedAt: f.now.toISOString(),
      revision: before.revision + 1,
    });
    expect(after.stops).toEqual(before.stops);
    expect(
      (await readLiveRoutes(f.db.pool, f.actor)).routes.find(
        (route) => route.id === before.id,
      ),
    ).toMatchObject({
      completedAt: f.now.toISOString(),
      progress: { delivered: 3, rescheduled: 0 },
    });
    expect(
      (
        await readDriverPlan(
          f.db.pool,
          f.members[0].driverId,
          f.planId,
          f.timezone,
        )
      ).publication.completedAt,
    ).toBe(f.now.toISOString());
    expect(
      (
        await f.db.pool.query(
          "SELECT snapshot,snapshot_hash,revision FROM route_plan_publications ORDER BY vehicle_id",
        )
      ).rows,
    ).toEqual(publication);
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int AS n FROM route_driver_execution_completions",
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int AS n FROM route_driver_mobile_audit WHERE action='mobile.route.completed'",
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await f.db.pool.query(
          "SELECT stopped,target_stop_id,eta,warehouse_depot_version FROM route_live_tracking WHERE execution_id=$1",
          [before.id],
        )
      ).rows[0],
    ).toEqual({
      stopped: true,
      target_stop_id: null,
      eta: null,
      warehouse_depot_version: null,
    });
    await expect(
      writeLiveTracking(f.db.pool, f.members[0].authorization, f.planId, {
        ...tracking,
        sessionId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "ROUTE_COMPLETED" });
    await expect(arrive(f, 0)).rejects.toMatchObject({
      code: "ROUTE_COMPLETED",
    });
    await expect(service(f, 0, "deliver")).rejects.toMatchObject({
      code: "ROUTE_COMPLETED",
    });
    await expect(
      f.db.pool.query("DELETE FROM route_driver_execution_completions"),
    ).rejects.toMatchObject({ code: "42501" });
    await f.db.pool.query("UPDATE rutas_installation SET schema_version=31");
    await migrate(f.db.pool, f.db.config.instanceId);
    await migrate(f.db.pool, f.db.config.instanceId);
    expect(
      (await f.db.pool.query("SELECT schema_version FROM rutas_installation"))
        .rows[0].schema_version,
    ).toBe(44);
    expect((await state(f)).stops).toEqual(before.stops);
  } finally {
    await f.close();
  }
}, 120000);

it("reprograms a real closed retry after leaving the visit, while delivery still requires arrival", async () => {
  const f = await executionFixture();
  try {
    await f.start();
    await depot(f);
    await arrive(f, 0);
    let stop = (await state(f)).stops[0];
    // Deliberately corrupt only the isolated DB projection: a status alone cannot fabricate a closed incident.
    await f.db.pool.query(
      "UPDATE route_driver_execution_orders SET status='closed_pending' WHERE execution_id=$1 AND stop_id=$2",
      [(await state(f)).id, stop.id],
    );
    await expect(service(f, 0, "reschedule")).rejects.toMatchObject({
      code: "RESCHEDULE_CLOSED_CASE_REQUIRED",
    });
    await f.db.pool.query(
      "UPDATE route_driver_execution_orders SET status='open' WHERE execution_id=$1 AND stop_id=$2",
      [(await state(f)).id, stop.id],
    );
    const photo = await sharp({
      create: { width: 24, height: 24, channels: 3, background: "#abcdef" },
    })
      .jpeg()
      .toBuffer();
    await reportCustomerClosed(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stop.id,
      await identity(f),
      photo,
      "image/jpeg",
      f.timezone,
      f.photoRoot,
      f.now,
    );
    stop = (await state(f)).stops[0];
    await exitDriverVisit(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stop.id,
      await identity(f),
      f.timezone,
      f.now,
    );
    expect((await state(f)).stops[0].arrivedAt).toBeNull();
    await expect(service(f, 0, "deliver")).rejects.toMatchObject({
      code: "VISIT_NOT_ACTIVE",
    });
    await service(f, 0, "reschedule");
    expect((await state(f)).stops[0].orderStates[0].status).toBe("rescheduled");
    for (const index of [1, 2]) {
      await arrive(f, index);
      await service(f, index, "deliver");
    }
    const terminal = await state(f),
      session = {
        executionId: terminal.id,
        publicationRevision: terminal.publicationRevision,
        sessionId: randomUUID(),
      };
    await writeLiveTracking(f.db.pool, f.members[0].authorization, f.planId, {
      ...session,
      kind: "begin",
    });
    const returnSample = {
      ...session,
      kind: "sample",
      sequence: 1,
      targetStopId: null,
      sample: null,
      destination: { kind: "warehouse", depotVersion: 1 },
    };
    await writeLiveTracking(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      returnSample,
    );
    expect(
      (await readLiveRoutes(f.db.pool, f.actor)).routes.find(
        (route) => route.id === terminal.id,
      )?.warehouseDestination,
    ).not.toBeNull();
    stop = terminal.stops[0];
    await retryDriverOrder(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stop.id,
      stop.orderStates[0].shipmentId,
      { ...(await identity(f)), orderVersion: stop.orderStates[0].version },
      f.timezone,
      f.now,
    );
    expect(
      (await readLiveRoutes(f.db.pool, f.actor)).routes.find(
        (route) => route.id === terminal.id,
      )?.warehouseDestination,
    ).toBeNull();
    await expect(
      writeLiveTracking(f.db.pool, f.members[0].authorization, f.planId, {
        ...returnSample,
        sequence: 2,
      }),
    ).rejects.toMatchObject({ code: "ROUTE_HAS_PENDING_ORDERS" });
    await arrive(f, 0);
    await reportCustomerClosed(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stop.id,
      await identity(f),
      photo,
      "image/jpeg",
      f.timezone,
      f.photoRoot,
      f.now,
    );
    await service(f, 0, "reschedule");
    await completeDriverRoute(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      await finishInput(f),
      f.now,
    );
    expect((await state(f)).stops[0].orderStates[0].status).toBe("rescheduled");
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int AS n FROM route_driver_service_incidents WHERE kind='rescheduled'",
        )
      ).rows[0].n,
    ).toBe(2);
  } finally {
    await f.close();
  }
}, 120000);

it("rolls back every effect on audit failure and serializes competing finalizations", async () => {
  const f = await executionFixture();
  try {
    await f.start();
    await depot(f);
    for (let index = 0; index < 3; index++) {
      await arrive(f, index);
      await service(f, index, "deliver");
    }
    const input = await finishInput(f),
      before = await state(f);
    const run = (command = input) =>
      completeDriverRoute(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        command,
        f.now,
      );
    await f.db.pool
      .query(`CREATE FUNCTION completion_qa_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='mobile.route.completed' THEN RAISE EXCEPTION 'qa_audit_failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER completion_qa_failure BEFORE INSERT ON route_driver_mobile_audit FOR EACH ROW EXECUTE FUNCTION completion_qa_failure()`);
    await expect(run()).rejects.toThrow("qa_audit_failure");
    expect((await state(f)).revision).toBe(before.revision);
    expect((await state(f)).completedAt).toBeNull();
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int AS n FROM route_driver_execution_completions",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      await readDriverCommandResult(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        input.commandId,
      ),
    ).toEqual({ confirmed: false, result: null });
    await f.db.pool.query(
      "DROP TRIGGER completion_qa_failure ON route_driver_mobile_audit; DROP FUNCTION completion_qa_failure()",
    );
    const results = await Promise.allSettled([
      run(),
      run({ ...input, commandId: randomUUID() }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "ROUTE_COMPLETED" } });
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int AS n FROM route_driver_execution_completions",
        )
      ).rows[0].n,
    ).toBe(1);
    expect((await state(f)).revision).toBe(before.revision + 1);
  } finally {
    await f.close();
  }
}, 120000);

it("a concurrent reopened retry cannot coexist with a finished execution", async () => {
  const f = await executionFixture();
  try {
    await f.start();
    await depot(f);
    await arrive(f, 0);
    const first = (await state(f)).stops[0];
    const photo = await sharp({
      create: { width: 24, height: 24, channels: 3, background: "#abcdef" },
    })
      .jpeg()
      .toBuffer();
    await reportCustomerClosed(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      first.id,
      await identity(f),
      photo,
      "image/jpeg",
      f.timezone,
      f.photoRoot,
      f.now,
    );
    await service(f, 0, "reschedule");
    for (const index of [1, 2]) {
      await arrive(f, index);
      await service(f, index, "deliver");
    }
    const before = await state(f),
      stop = before.stops[0],
      order = stop.orderStates[0];
    const results = await Promise.allSettled([
      completeDriverRoute(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        await finishInput(f),
        f.now,
      ),
      retryDriverOrder(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        stop.id,
        order.shipmentId,
        { ...(await identity(f)), orderVersion: order.version },
        f.timezone,
        f.now,
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const after = await state(f);
    if (after.completedAt)
      expect(after.stops[0].orderStates[0].status).toBe("rescheduled");
    else expect(after.stops[0].orderStates[0].status).toBe("open");
    expect(after.revision).toBe(before.revision + 1);
  } finally {
    await f.close();
  }
}, 120000);
