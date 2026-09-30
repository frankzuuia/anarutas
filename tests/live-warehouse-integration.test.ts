import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import { executeDriverOrderCommand } from "../src/core/driver-order-command";
import { writeLiveTracking } from "../src/core/live-tracking";
import { readLiveRoutes } from "../src/core/live-routes";
import { saveRoutingSettings } from "../src/core/routing-settings";
import { routeDestinationLabel } from "../src/core/live-route-destination";
import { routeEta } from "../src/core/live-eta";
import { migrate } from "../src/core/database";
import { cancelPublishedRoute } from "../src/core/route-publications";

it("accepts only the current terminal warehouse, isolates sessions and preserves business data", async () => {
  const f = await executionFixture();
  try {
    await f.start(); await f.start(f.members[1]);
    const state = () => readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
    const execution = await state();
    const identity = { executionId: execution.id, publicationRevision: execution.publicationRevision, sessionId: randomUUID() };
    const destination = { kind: "warehouse", depotVersion: 1 };
    const eta = { targetStopId: null, depotVersion: 1, state: "ready", remainingSeconds: 600, ageMilliseconds: 0 };
    const sample = { latitude: 20.64, longitude: -103.4, accuracyMeters: 5, ageMilliseconds: 0, mock: false };
    const writes: number[] = [], reads: number[] = [];
    const post = async (data: Record<string, unknown>, authorization = f.members[0].authorization) => {
      const began = performance.now();
      const result = await writeLiveTracking(f.db.pool, authorization, f.planId, { ...identity, ...data });
      if (result.accepted && data.kind === "sample" && data.destination) writes.push(performance.now() - began);
      return result;
    };
    const read = async () => {
      const began = performance.now(), report = await readLiveRoutes(f.db.pool, f.actor);
      reads.push(performance.now() - began); return report.routes.find(r => r.id === execution.id)!;
    };
    const returning = (sequence: number) => ({ kind: "sample", sequence, targetStopId: null, destination, eta, sample });
    await post({ kind: "begin" });
    expect((await read()).warehouseDestination).toBeNull();
    await expect(post(returning(1))).rejects.toMatchObject({ code: "ROUTING_ORIGIN_REQUIRED" });
    const configure = (version: number) => saveRoutingSettings(f.db.pool, f.actor, { expectedVersion: version, depotAddress: "Bodega QA",
      depotLocation: { latitude: 20.64, longitude: -103.4, placeId: "qa-depot" } });
    await configure(0);
    await expect(post(returning(1))).rejects.toMatchObject({ code: "ROUTE_HAS_PENDING_ORDERS" });
    for (const index of [0, 1, 2]) {
      const before = await state(), stop = before.stops[index];
      const arrivalIdentity = { commandId: randomUUID(), executionId: before.id, publicationRevision: before.publicationRevision,
        executionRevision: before.revision, stopVersion: stop.version, visitSequence: stop.visitSequence, policyVersion: before.policy.version };
      await executeStopCommand(f.db.pool, f.members[0].authorization, f.planId, stop.id, "arrival",
        { ...arrivalIdentity, sample: { ...sample, capturedAt: f.now.toISOString() } }, f.timezone, f.now);
      const arrived = await state(), current = arrived.stops[index];
      await executeDriverOrderCommand(f.db.pool, f.members[0].authorization, f.planId, current.id, current.orderStates[0].shipmentId,
        { ...arrivalIdentity, commandId: randomUUID(), executionRevision: arrived.revision, stopVersion: current.version,
          visitSequence: current.visitSequence, orderVersion: current.orderStates[0].version, kind: "deliver" }, f.timezone, f.now);
    }
    const before = await state();
    const snapshot = async () => (await f.db.pool.query("SELECT snapshot,snapshot_hash,revision FROM route_plan_publications ORDER BY vehicle_id")).rows;
    const publication = await snapshot();
    await expect(post(returning(1), "Bearer invalid")).rejects.toMatchObject({ status: 401 });
    await expect(post(returning(1), f.members[1].authorization)).rejects.toMatchObject({ code: "TRACKING_SESSION_CHANGED" });
    await expect(readLiveRoutes(f.db.pool, randomUUID())).rejects.toMatchObject({ status: 401 });
    expect((await post(returning(1))).accepted).toBe(true);
    const first = await read();
    expect(first.warehouseDestination).toMatchObject({ kind: "warehouse", depotVersion: 1, address: "Bodega QA", latitude: 20.64, longitude: -103.4 });
    expect(first.targetStopId).toBeNull(); expect(first.arrivedStopId).toBeNull();
    expect(routeDestinationLabel(first, Date.now())).toBe("De regreso a bodega");
    expect(routeEta(first, Date.now())).toBe("≈10 min");
    const results = await Promise.all([post(returning(2)), post({ ...returning(3), sample: null, eta: null })]);
    expect(results[1].accepted).toBe(true);
    const latest = await read();
    expect(latest.eta).toBeNull();
    expect(Date.parse(latest.location!.observedAt)).toBeGreaterThanOrEqual(Date.parse(first.location!.observedAt));
    const gpsTime = latest.location!.observedAt;
    await post({ ...returning(4), sample: { ...sample, ageMilliseconds: 60000 } });
    expect((await read()).location!.observedAt).toBe(gpsTime);
    expect((await post({ ...returning(3), destination: null, eta: null })).accepted).toBe(false);
    expect((await read()).warehouseDestination).not.toBeNull();
    expect((await f.db.pool.query("SELECT count(*)::int n FROM route_driver_mobile_audit WHERE action='tracking.destination.changed'")).rows[0].n).toBe(1);
    const after = await state();
    expect(after).toEqual({ ...before, serverTime: after.serverTime });
    expect(await snapshot()).toEqual(publication);
    expect((await f.db.pool.query("SELECT count(*)::int n FROM route_driver_execution_completions")).rows[0].n).toBe(0);
    // A read validates current settings even before an old client sends again.
    await configure(1);
    expect((await read()).warehouseDestination).toBeNull(); expect((await read()).eta).toBeNull();
    await expect(post(returning(5))).rejects.toMatchObject({ code: "ROUTING_ORIGIN_CHANGED" });
    destination.depotVersion = 2; eta.depotVersion = 2;
    await post(returning(5));
    expect((await read()).warehouseDestination?.depotVersion).toBe(2);
    await post({ kind: "sample", sequence: 6, targetStopId: null, sample: null });
    expect((await read()).warehouseDestination).toBeNull();
    await post(returning(7));
    const beforeMigration = (await f.db.pool.query("SELECT * FROM route_live_tracking ORDER BY execution_id")).rows;
    await f.db.pool.query("UPDATE rutas_installation SET schema_version=32 WHERE singleton=true");
    await Promise.all([migrate(f.db.pool, f.db.config.instanceId), migrate(f.db.pool, f.db.config.instanceId)]);
    expect((await f.db.pool.query("SELECT * FROM route_live_tracking ORDER BY execution_id")).rows).toEqual(beforeMigration);
    await expect(f.db.pool.query("UPDATE route_live_tracking SET warehouse_depot_version=0 WHERE execution_id=$1", [execution.id])).rejects.toMatchObject({ code: "23514" });
    await expect(f.db.pool.query("UPDATE route_live_tracking SET target_stop_id=$2 WHERE execution_id=$1", [execution.id, execution.stops[0].id])).rejects.toMatchObject({ code: "23514" });
    await post({ kind: "stop", sequence: 8 });
    expect((await read()).warehouseDestination).toBeNull();
    await expect(post(returning(9))).rejects.toMatchObject({ code: "TRACKING_SESSION_CHANGED" });
    identity.sessionId = randomUUID(); await post({ kind: "begin" });
    expect((await read()).warehouseDestination).toBeNull(); await post(returning(1));
    // Reconstruct actual v32 only inside this owned, disposable PostgreSQL.
    await f.db.pool.query("ALTER TABLE route_live_tracking DROP COLUMN warehouse_depot_version; UPDATE rutas_installation SET schema_version=32 WHERE singleton=true");
    const legacy = (await f.db.pool.query("SELECT * FROM route_live_tracking ORDER BY execution_id")).rows;
    await Promise.all([migrate(f.db.pool, f.db.config.instanceId), migrate(f.db.pool, f.db.config.instanceId)]);
    expect((await f.db.pool.query("SELECT schema_version FROM rutas_installation")).rows[0].schema_version).toBe(33);
    expect((await f.db.pool.query("SELECT * FROM route_live_tracking ORDER BY execution_id")).rows).toEqual(legacy.map(row => ({ ...row, warehouse_depot_version: null })));
    expect((await read()).warehouseDestination).toBeNull();
    await post(returning(2));
    await f.db.pool.query("UPDATE route_driver_mobile_devices SET revoked_at=now() WHERE id=$1", [f.members[0].deviceId]);
    expect((await read()).warehouseDestination).toBeNull();
    await expect(post(returning(3))).rejects.toMatchObject({ status: 401 });
    await f.db.pool.query("UPDATE route_driver_mobile_devices SET revoked_at=NULL WHERE id=$1", [f.members[0].deviceId]);
    identity.sessionId = randomUUID(); await post({ kind: "begin" });
    expect((await read()).warehouseDestination).toBeNull(); await post(returning(1));
    await f.db.pool.query("UPDATE route_driver_mobile_sessions SET revoked_at=now() WHERE device_id=$1", [f.members[0].deviceId]);
    expect((await read()).warehouseDestination).toBeNull();
    await expect(post(returning(3))).rejects.toMatchObject({ status: 401 });
    const plan = (await f.db.pool.query("SELECT version FROM route_plans WHERE id=$1", [f.planId])).rows[0];
    await cancelPublishedRoute(f.db.pool, f.actor, f.planId, f.members[0].vehicleId, { expectedVersion: plan.version, expectedRevision: 1 });
    expect((await readLiveRoutes(f.db.pool, f.actor)).routes.some(r => r.id === execution.id)).toBe(false);
    expect((await snapshot()).map(({ snapshot, snapshot_hash }) => ({ snapshot, snapshot_hash })))
      .toEqual(publication.map(({ snapshot, snapshot_hash }) => ({ snapshot, snapshot_hash })));
    const summarize = (values: number[]) => {
      const sorted = [...values].sort((a,b) => a-b);
      return { samples: sorted.length, p50Milliseconds: sorted[Math.ceil(sorted.length * .5) - 1],
        p95Milliseconds: sorted[Math.ceil(sorted.length * .95) - 1], maximumMilliseconds: sorted.at(-1) };
    };
    await mkdir("reports", { recursive: true });
    await writeFile("reports/live-warehouse-latency.json", JSON.stringify({ environment: "Real isolated local PostgreSQL; not a production/network/SDK SLO",
      write: summarize(writes), read: summarize(reads), unexpectedErrors: 0 }, null, 2));
  } finally { await f.close(); }
}, 120000);
