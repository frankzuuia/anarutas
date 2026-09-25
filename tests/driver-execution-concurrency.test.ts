import { randomInt, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";

it("corrects either coordinate when customer and execution disagree and retains both previous points", async () => {
  const f = await executionFixture();
  const { pool } = f.db;
  const [a, b] = f.members;
  try {
    await f.start(a);
    await f.start(b);
    const lat = { latitude: 20.6401, longitude: -103.4 };
    const lon = { latitude: 20.6401, longitude: -103.3999 };
    const moves = [
      { member: a, point: lat },
      // The second driver still has the original snapshot. Matching the master
      // customer alone must not skip correction of this execution's stop.
      { member: b, point: lat },
      { member: a, point: lon },
      { member: b, point: lon },
      { member: a, point: { latitude: 20.6402, longitude: lon.longitude } },
      // Conversely, retaining this driver's point must still correct a master
      // customer changed by someone else. Exercise each axis independently.
      { member: b, point: lon },
      { member: a, point: { latitude: lon.latitude, longitude: -103.3998 } },
      { member: b, point: lon },
    ];
    for (const { member, point } of moves) {
      const state = await readDriverExecution(pool, member.driverId, f.planId, f.timezone);
      const stop = state.stops[0];
      const before = (await pool.query("SELECT latitude,longitude FROM route_customers WHERE id=$1", [stop.customerId])).rows[0];
      const result = await executeStopCommand(pool, member.authorization, f.planId, stop.id, "repoint", {
        commandId: randomUUID(), executionId: state.id, publicationRevision: state.publicationRevision,
        executionRevision: state.revision, stopVersion: stop.version, policyVersion: state.policy.version,
        customerLocationVersion: stop.customerLocationVersion, point,
        sample: { ...point, accuracyMeters: 5, ageMilliseconds: 0, capturedAt: f.now.toISOString(), mock: false },
      }, f.timezone, f.now);
      expect(result).toMatchObject({ executionRevision: state.revision + 1, duplicate: false });
      expect(result.unchanged).not.toBe(true);
      expect((await pool.query("SELECT details FROM route_driver_stop_events WHERE id=$1", [result.eventId])).rows[0].details)
        .toMatchObject({ customerBefore: before, before: { latitude: stop.latitude, longitude: stop.longitude }, point });
      const current = await readDriverExecution(pool, member.driverId, f.planId, f.timezone);
      expect(current.stops[0]).toMatchObject({ ...point, version: stop.version + 1, customerLocationVersion: stop.customerLocationVersion + 1 });
    }
    expect((await pool.query("SELECT count(*)::int n FROM route_driver_stop_events")).rows[0].n).toBe(moves.length);
  } finally { await f.close(); }
}, 120_000);

it("holds authorization, publication, execution, policy and command-key locks until commit", async () => {
  const f = await executionFixture();
  const { pool } = f.db;
  const [a] = f.members;
  const barrier = await pool.connect();
  const barrierKey = randomInt(1, 2_147_483_647);
  let pending: Promise<{ result?: Awaited<ReturnType<typeof executeStopCommand>>; error?: unknown }> | undefined;
  try {
    await f.start();
    const state = await readDriverExecution(pool, a.driverId, f.planId, f.timezone);
    const commandId = randomUUID();
    const barrierPid = (await barrier.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await barrier.query("SELECT pg_advisory_lock($1::bigint)", [barrierKey]);
    // A real transaction barrier, not a replaced database/API implementation:
    // pause immediately before the event insert, while all guards must be held.
    await pool.query(`CREATE FUNCTION execution_qa_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(${barrierKey}::bigint); RETURN NEW; END $$;
      CREATE TRIGGER execution_qa_barrier BEFORE INSERT ON route_driver_stop_events
        FOR EACH ROW EXECUTE FUNCTION execution_qa_barrier()`);
    pending = executeStopCommand(pool, a.authorization, f.planId, state.stops[0].id, "arrival", {
      commandId, executionId: state.id, publicationRevision: state.publicationRevision,
      executionRevision: state.revision, stopVersion: state.stops[0].version, policyVersion: state.policy.version,
      sample: { latitude: 20.64, longitude: -103.4, accuracyMeters: 5, ageMilliseconds: 0,
        capturedAt: f.now.toISOString(), mock: false },
    }, f.timezone, f.now).then(result => ({ result }), error => ({ error }));
    await expect.poll(async () => (await pool.query(
      "SELECT count(*)::int n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [barrierPid],
    )).rows[0].n, { timeout: 5000 }).toBe(1);

    const protectedRows = [
      { query: "SELECT id FROM route_drivers WHERE id=$1 FOR UPDATE NOWAIT", values: [a.driverId] },
      { query: "SELECT driver_id FROM route_driver_mobile_access WHERE driver_id=$1 FOR UPDATE NOWAIT", values: [a.driverId] },
      { query: "SELECT id FROM route_driver_mobile_devices WHERE id=$1 FOR UPDATE NOWAIT", values: [a.deviceId] },
      { query: "SELECT token_hash FROM route_driver_mobile_sessions WHERE device_id=$1 FOR UPDATE NOWAIT", values: [a.deviceId] },
      { query: "SELECT id FROM route_plans WHERE id=$1 FOR UPDATE NOWAIT", values: [f.planId] },
      // SHARE is deliberate: another writer must not simultaneously pass version
      // checks by holding only a compatible SHARE lock on publication/execution.
      { query: "SELECT plan_id FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2 FOR SHARE NOWAIT", values: [f.planId, a.vehicleId] },
      { query: "SELECT id FROM route_driver_executions WHERE id=$1 FOR SHARE NOWAIT", values: [state.id] },
      { query: "SELECT singleton FROM route_driver_operation_settings FOR UPDATE NOWAIT", values: [] },
    ];
    for (const row of protectedRows) {
      await expect(pool.query(row.query, row.values), row.query).rejects.toMatchObject({ code: "55P03" });
    }
    expect((await pool.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", [
      `driver-command:${a.deviceId}:${commandId}`,
    ])).rows[0].acquired).toBe(false);
    await barrier.query("SELECT pg_advisory_unlock($1::bigint)", [barrierKey]);
    const outcome = await pending;
    expect(outcome.error).toBeUndefined();
    expect(outcome.result).toMatchObject({ executionRevision: 2, duplicate: false });
    expect((await pool.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired", [
      `driver-command:${a.deviceId}:${commandId}`,
    ])).rows[0].acquired).toBe(true);
  } finally {
    await barrier.query("SELECT pg_advisory_unlock_all()");
    if (pending) await pending;
    barrier.release();
    await f.close();
  }
}, 120_000);
