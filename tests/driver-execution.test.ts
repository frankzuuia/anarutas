import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { executionFixture } from "./helpers/driver-execution";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import { readDriverIncidents } from "../src/core/driver-incidents";
import { readOperationPolicy, saveOperationPolicy } from "../src/core/driver-operation-settings";
import { driverPublicationFingerprint } from "../src/core/driver-mobile-events";
import { readDriverPlan } from "../src/core/driver-mobile-route";
import { cancelPublishedRoute } from "../src/core/route-publications";
import { orderBoard } from "../src/core/orders";
import { deletePlan } from "../src/core/plans";
import { migrate } from "../src/core/database";
import { dropExecutionTablesForLegacyFixture } from "./helpers/postgres";
import { revokeMobileAccess } from "../src/core/driver-mobile-auth";
import { persistCustomerPage } from "../src/core/customers";

// One atomic lifecycle: mutation runners may select individual tests, never partial setup.
it("authorizes, validates, persists and retires real driver execution without rewriting snapshots", async () => {
  const f = await executionFixture();
  const { pool } = f.db;
  const [a, b] = f.members;
  const read = () => readDriverExecution(pool, a.driverId, f.planId, f.timezone);
  try {
    await expect(read()).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await f.start();
    await f.start(b);
    await dropExecutionTablesForLegacyFixture(pool);
    await pool.query(`DROP TRIGGER route_customer_recalculation ON route_customers;
      ALTER TABLE route_customers DROP CONSTRAINT customer_update_actor;
      ALTER TABLE route_customers DROP COLUMN updated_by_driver;
      ALTER TABLE route_customers ALTER COLUMN updated_by SET NOT NULL;
      ALTER TABLE route_customer_location_history DROP CONSTRAINT customer_location_driver_actor;
      ALTER TABLE route_customer_location_history DROP COLUMN driver_id;
      UPDATE rutas_installation SET schema_version=19`);
    await migrate(pool, f.db.config.instanceId);
    const initial = await read();
    expect(initial.stops).toHaveLength(3);
    expect(initial.stops.map(s => s.orderNames)).toEqual([["S1"], ["S2"], ["S3"]]);
    expect(initial.policy).toEqual({ radiusMeters: 100, maxAccuracyMeters: 50, maxSampleAgeSeconds: 30, version: 1 });
    await pool.query("UPDATE rutas_installation SET schema_version=19");
    await migrate(pool, f.db.config.instanceId);
    expect((await read()).id).toBe(initial.id);
    expect((await pool.query("SELECT count(*)::int n FROM route_driver_execution_stops")).rows[0].n).toBe(4);
    const snapshots = (await pool.query("SELECT vehicle_id,snapshot FROM route_plan_publications ORDER BY vehicle_id")).rows;
    const fingerprintA = await driverPublicationFingerprint(pool, a.driverId);
    const fingerprintB = await driverPublicationFingerprint(pool, b.driverId);
    const sample = { latitude: 20.64, longitude: -103.4, accuracyMeters: 5, ageMilliseconds: 0, capturedAt: f.now.toISOString(), mock: false };
    const inputFor = (state: typeof initial, index = 0) => ({ commandId: randomUUID(), executionId: state.id,
      publicationRevision: state.publicationRevision, executionRevision: state.revision, stopVersion: state.stops[index].version,
      policyVersion: state.policy.version, sample });
    const run = (kind: "arrival" | "repoint", input: Record<string, unknown>, stopId = initial.stops[0].id, auth = a.authorization) =>
      executeStopCommand(pool, auth, f.planId, stopId, kind, input, f.timezone, f.now);
    const arrival = inputFor(initial);
    await expect(run("arrival", arrival, initial.stops[0].id, b.authorization)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(run("arrival", arrival, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(run("arrival", arrival, initial.stops[0].id, "Bearer bad")).rejects.toMatchObject({ status: 401 });
    await expect(run("arrival", { ...arrival, executionRevision: 99 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(run("arrival", { ...arrival, policyVersion: 99 })).rejects.toMatchObject({ code: "OPERATION_POLICY_CHANGED" });
    await expect(run("arrival", { ...arrival, sample: { ...sample, latitude: 21 } })).rejects.toMatchObject({ code: "OUTSIDE_ARRIVAL_RADIUS" });
    await expect(run("arrival", { ...arrival, sample: { ...sample, accuracyMeters: 51 } })).rejects.toMatchObject({ code: "LOCATION_IMPRECISE" });
    await expect(run("arrival", { ...arrival, sample: { ...sample, ageMilliseconds: 30001 } })).rejects.toMatchObject({ code: "LOCATION_STALE" });
    await expect(run("arrival", { ...arrival, sample: { ...sample, mock: true } })).rejects.toMatchObject({ code: "LOCATION_UNTRUSTED" });
    expect((await pool.query("SELECT count(*)::int n FROM route_driver_stop_events")).rows[0].n).toBe(0);
    const duplicates = await Promise.all([run("arrival", arrival), run("arrival", arrival)]);
    expect(duplicates[0].eventId).toBe(duplicates[1].eventId);
    expect(duplicates.filter(r => r.duplicate)).toHaveLength(1);
    expect((await read()).stops[0].arrivedAt).toBe(f.now.toISOString());
    expect((await read()).revision).toBe(2);
    expect(await run("arrival", { ...arrival, commandId: randomUUID() }))
      .toMatchObject({ eventId: duplicates[0].eventId, duplicate: true });
    await expect(run("arrival", { ...arrival, sample: { ...sample, accuracyMeters: 4 } })).rejects.toMatchObject({ code: "COMMAND_REUSED" });
    expect(await driverPublicationFingerprint(pool, a.driverId)).not.toBe(fingerprintA);
    expect(await driverPublicationFingerprint(pool, b.driverId)).toBe(fingerprintB);

    let state = await read();
    const point = { latitude: 20.6403, longitude: -103.4 };
    const repoint = { ...inputFor(state), point, customerLocationVersion: state.stops[0].customerLocationVersion };
    // This real trigger would fail the command if driver updates queued recalculation.
    await pool.query(`CREATE OR REPLACE FUNCTION route_customer_recalculation_changed() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'UNWANTED_FLEET_RECALCULATION'; END $$`);
    await expect(run("repoint", { ...repoint, customerLocationVersion: 99 })).rejects.toMatchObject({ code: "CUSTOMER_LOCATION_CONFLICT" });
    // Force a real DB failure after the customer write, proving transaction rollback.
    await pool.query(`CREATE FUNCTION fail_execution_qa() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA_ROLLBACK'; END $$;
      CREATE TRIGGER fail_execution_qa BEFORE INSERT ON route_driver_stop_events FOR EACH ROW EXECUTE FUNCTION fail_execution_qa()`);
    await expect(run("repoint", repoint)).rejects.toThrow("QA_ROLLBACK");
    expect((await read()).stops[0].latitude).toBe(20.64);
    expect((await pool.query("SELECT latitude FROM route_customers WHERE id=$1", [state.stops[0].customerId])).rows[0].latitude).toBe(20.64);
    await pool.query("DROP TRIGGER fail_execution_qa ON route_driver_stop_events; DROP FUNCTION fail_execution_qa()");
    const saved = await run("repoint", repoint);
    expect(saved).toMatchObject({ duplicate: false, executionRevision: 3 });
    expect((await run("repoint", repoint)).eventId).toBe(saved.eventId);
    state = await read();
    expect(state).toMatchObject({ revision: 3, hasCorrections: true });
    expect(state.stops[0]).toMatchObject({ ...point, arrivedAt: f.now.toISOString(), version: 3 });
    const customer = (await pool.query("SELECT latitude,longitude,location_status,updated_by,updated_by_driver FROM route_customers WHERE id=$1", [state.stops[0].customerId])).rows[0];
    expect(customer).toEqual({ ...point, location_status: "driver_confirmed", updated_by: null, updated_by_driver: a.driverId });
    const sourceCustomer = (await pool.query("SELECT source,odoo_partner_id FROM route_customers WHERE id=$1", [state.stops[0].customerId])).rows[0];
    await persistCustomerPage(pool, f.actor, { fingerprint: sourceCustomer.source,
      customers: [{ partnerId: sourceCustomer.odoo_partner_id, parentId: null, parentName: null, commercialPartnerId: null,
        commercialName: null, companyId: null, type: "contact", isCompany: true, active: true, name: "Nombre de origen nuevo",
        reference: null, phone: null, mobile: null, address: "Dirección recibida del origen" }], nextCursor: 1, ceiling: 1, hasMore: false });
    expect((await pool.query("SELECT latitude,longitude,location_status,updated_by_driver,display_name,delivery_address FROM route_customers WHERE id=$1", [state.stops[0].customerId])).rows[0])
      .toEqual({ ...point, location_status: "driver_confirmed", updated_by_driver: a.driverId, display_name: "Cliente 1", delivery_address: "Calle 1" });
    expect((await pool.query("SELECT driver_id,source,actor_id FROM route_customer_location_history")).rows).toEqual([
      { driver_id: a.driverId, source: "driver", actor_id: null },
    ]);
    expect((await readDriverExecution(pool, b.driverId, f.planId, f.timezone)).stops[0].latitude).toBe(20.64);
    expect((await pool.query("SELECT vehicle_id,snapshot FROM route_plan_publications ORDER BY vehicle_id")).rows).toEqual(snapshots);
    expect(await readDriverPlan(pool, a.driverId, f.planId, f.timezone)).toMatchObject({ routeStatus: "point_corrected" });
    expect(await run("repoint", { ...inputFor(state), point, customerLocationVersion: state.stops[0].customerLocationVersion })).toMatchObject({ unchanged: true, eventId: null });
    const filters = new URLSearchParams({ from: "2026-09-24", to: "2026-09-24", driverId: a.driverId });
    const incidents = await readDriverIncidents(pool, filters, f.timezone);
    expect(incidents.rows).toHaveLength(2);
    expect(incidents.rows.map(r => r.kind).sort()).toEqual(["late_arrival", "location_corrected"]);
    expect(incidents.rows.find(r => r.kind === "late_arrival")?.details.lateSeconds).toBe(3600);
    expect(incidents.rows[0].details).not.toHaveProperty("sample");
    filters.set("driverId", b.driverId);
    expect((await readDriverIncidents(pool, filters, f.timezone)).rows).toEqual([]);
    filters.delete("driverId"); filters.set("from", "2026-09-25"); filters.set("to", "2026-09-25");
    expect((await readDriverIncidents(pool, filters, f.timezone)).rows).toEqual([]);
    await expect(pool.query("UPDATE route_driver_stop_events SET kind='arrival'")).rejects.toThrow("DRIVER_EVENT_IMMUTABLE");
    await expect(pool.query("DELETE FROM route_driver_command_receipts")).rejects.toThrow("DRIVER_EVENT_IMMUTABLE");
    await expect(saveOperationPolicy(pool, randomUUID(), { radiusMeters: 150, maxAccuracyMeters: 30, maxSampleAgeSeconds: 20, expectedVersion: 1 })).rejects.toMatchObject({ status: 401 });
    const policy = await saveOperationPolicy(pool, f.actor, { radiusMeters: 150, maxAccuracyMeters: 30, maxSampleAgeSeconds: 20, expectedVersion: 1 });
    expect(policy).toEqual({ radiusMeters: 150, maxAccuracyMeters: 30, maxSampleAgeSeconds: 20, version: 2 });
    expect(await readOperationPolicy(pool)).toEqual(policy);
    await expect(run("arrival", inputFor(state, 1), state.stops[1].id)).rejects.toMatchObject({ code: "OPERATION_POLICY_CHANGED" });
    const board = await orderBoard(pool, f.planId);
    for (const m of f.members) await cancelPublishedRoute(pool, f.actor, f.planId, m.vehicleId, { expectedVersion: board.plan.version, expectedRevision: 1 });
    await expect(read()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(run("arrival", inputFor(state, 1), state.stops[1].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deletePlan(pool, f.actor, f.planId, { expectedVersion: board.plan.version });
    expect((await pool.query("SELECT count(*)::int n FROM route_driver_stop_events")).rows[0].n).toBe(2);
  } finally { await f.close(); }
}, 120_000);

it("serializes competing corrections, cancellation and access revocation against real PostgreSQL", async () => {
  const f = await executionFixture();
  const { pool } = f.db;
  const [a, b] = f.members;
  const sample = { latitude: 20.64, longitude: -103.4, accuracyMeters: 5, ageMilliseconds: 0, capturedAt: f.now.toISOString(), mock: false };
  const read = (member = a) => readDriverExecution(pool, member.driverId, f.planId, f.timezone);
  const input = (state: Awaited<ReturnType<typeof read>>, index = 0) => ({ commandId: randomUUID(), executionId: state.id,
    publicationRevision: state.publicationRevision, executionRevision: state.revision, stopVersion: state.stops[index].version,
    policyVersion: state.policy.version, sample, customerLocationVersion: state.stops[index].customerLocationVersion });
  try {
    await f.start(); await f.start(b);
    const [ea, eb] = await Promise.all([read(a), read(b)]);
    const edits = await Promise.allSettled([a, b].map((member, index) => {
      const e = [ea, eb][index];
      return executeStopCommand(pool, member.authorization, f.planId, e.stops[0].id, "repoint",
        { ...input(e), point: { latitude: 20.6401 + index * .0001, longitude: -103.4 } }, f.timezone, f.now);
    }));
    expect(edits.filter(e => e.status === "fulfilled")).toHaveLength(1);
    expect(edits.find(e => e.status === "rejected")).toMatchObject({ reason: { code: "CUSTOMER_LOCATION_CONFLICT" } });
    expect((await pool.query("SELECT count(*)::int n FROM route_customer_location_history")).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int n FROM route_driver_stop_events")).rows[0].n).toBe(1);
    const current = await read();
    await expect(executeStopCommand(pool, a.authorization, f.planId, current.stops[1].id, "arrival",
      { ...input(current, 1), stopVersion: 99 }, f.timezone, f.now)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(executeStopCommand(pool, a.authorization, f.planId, current.stops[1].id, "arrival",
      { ...input(current, 1), publicationRevision: 99 }, f.timezone, f.now)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    // Archive is a real persisted state, never an authorization stub.
    await pool.query("UPDATE route_customers SET archived_at=now() WHERE id=$1", [current.stops[1].customerId]);
    await expect(executeStopCommand(pool, a.authorization, f.planId, current.stops[1].id, "repoint",
      { ...input(current, 1), point: { latitude: 20.6401, longitude: -103.4 } }, f.timezone, f.now))
      .rejects.toMatchObject({ code: "CUSTOMER_UNAVAILABLE" });
    await pool.query("UPDATE route_customers SET archived_at=NULL WHERE id=$1", [current.stops[1].customerId]);
    // Closing exactly and no window are facts, not late-arrival incidents.
    const atClose = new Date("2026-09-24T16:00:00.000Z");
    const punctual = await executeStopCommand(pool, a.authorization, f.planId, current.stops[1].id, "arrival",
      { ...input(current, 1), sample: { ...sample, capturedAt: atClose.toISOString() } }, f.timezone, atClose);
    expect((await pool.query("SELECT incident_kind,details FROM route_driver_stop_events WHERE id=$1", [punctual.eventId])).rows[0])
      .toMatchObject({ incident_kind: null, details: { lateSeconds: 0 } });
    const next = await read();
    await pool.query("UPDATE route_driver_execution_stops SET windows='[]' WHERE id=$1", [next.stops[2].id]);
    const tomorrow = new Date("2026-09-25T06:01:00.000Z");
    const noWindow = await executeStopCommand(pool, a.authorization, f.planId, next.stops[2].id, "arrival",
      { ...input(next, 2), sample: { ...sample, capturedAt: tomorrow.toISOString() } }, f.timezone, tomorrow);
    expect((await pool.query("SELECT event_date::text,incident_kind,details FROM route_driver_stop_events WHERE id=$1", [noWindow.eventId])).rows[0])
      .toMatchObject({ event_date: "2026-09-25", incident_kind: null, details: { lateSeconds: null, serviceDate: "2026-09-24" } });
    const after = await read();
    // Reuse the accepted key with an old GPS sample: receipt recovery precedes age checks.
    const retryBody = { ...input(after), point: { latitude: 20.6404, longitude: -103.4 } };
    const repoint = await executeStopCommand(pool, a.authorization, f.planId, after.stops[0].id, "repoint", retryBody, f.timezone, f.now);
    expect(await executeStopCommand(pool, a.authorization, f.planId, after.stops[0].id, "repoint", retryBody, f.timezone, tomorrow))
      .toMatchObject({ eventId: repoint.eventId, duplicate: true });
    await expect(saveOperationPolicy(pool, f.actor, { radiusMeters: 120, maxAccuracyMeters: 40, maxSampleAgeSeconds: 20, expectedVersion: 99 }))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    const ready = await read(b);
    const board = await orderBoard(pool, f.planId);
    const cancelledRace = await Promise.allSettled([
      executeStopCommand(pool, b.authorization, f.planId, ready.stops[0].id, "arrival", input(ready), f.timezone, f.now),
      cancelPublishedRoute(pool, f.actor, f.planId, b.vehicleId, { expectedVersion: board.plan.version, expectedRevision: 1 }),
    ]);
    expect(cancelledRace[1].status).toBe("fulfilled");
    if (cancelledRace[0].status === "rejected") expect(cancelledRace[0].reason).toMatchObject({ code: "NOT_FOUND" });
    await expect(read(b)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const active = await read();
    const revokedRace = await Promise.allSettled([
      executeStopCommand(pool, a.authorization, f.planId, active.stops[0].id, "arrival", input(active), f.timezone, f.now),
      revokeMobileAccess(pool, f.actor, a.driverId, 1),
    ]);
    expect(revokedRace[1].status).toBe("fulfilled");
    if (revokedRace[0].status === "rejected") expect(revokedRace[0].reason).toMatchObject({ status: 401 });
    await expect(executeStopCommand(pool, a.authorization, f.planId, after.stops[0].id, "repoint", retryBody, f.timezone, f.now))
      .rejects.toMatchObject({ status: 401 });
  } finally { await f.close(); }
}, 120_000);

it("pages real incident history without dropping sub-millisecond events and retains inactive drivers", async () => {
  const f = await executionFixture();
  const { pool } = f.db;
  const [a, b] = f.members;
  try {
    await f.start();
    const e = await readDriverExecution(pool, a.driverId, f.planId, f.timezone);
    const point = { latitude: 20.6401, longitude: -103.4 };
    await executeStopCommand(pool, a.authorization, f.planId, e.stops[0].id, "repoint", {
      commandId: randomUUID(), executionId: e.id, publicationRevision: e.publicationRevision, executionRevision: e.revision,
      stopVersion: e.stops[0].version, policyVersion: e.policy.version, customerLocationVersion: e.stops[0].customerLocationVersion,
      point, sample: { ...point, accuracyMeters: 5, ageMilliseconds: 0, capturedAt: f.now.toISOString(), mock: false },
    }, f.timezone, f.now);
    // SQL history fixtures exercise PostgreSQL microsecond ordering (JS Date only has milliseconds).
    await pool.query(`INSERT INTO route_driver_stop_events(id,execution_id,stop_id,driver_id,device_id,kind,incident_kind,occurred_at,event_date,timezone,details)
      SELECT gen_random_uuid(),e.execution_id,e.stop_id,e.driver_id,e.device_id,e.kind,e.incident_kind,
        e.occurred_at + n * interval '1 microsecond',e.event_date,e.timezone,e.details
      FROM route_driver_stop_events e CROSS JOIN generate_series(1,54) n`);
    await pool.query("UPDATE route_drivers SET active=false WHERE id=$1", [a.driverId]);
    const query = new URLSearchParams({ from: "2026-09-24", to: "2026-09-24", driverId: a.driverId });
    const first = await readDriverIncidents(pool, query, f.timezone);
    expect(first.rows).toHaveLength(50); expect(first.nextCursor).not.toBeNull();
    expect(first.drivers.find(d => d.id === a.driverId)).toMatchObject({ active: false });
    query.set("cursor", first.nextCursor!);
    const second = await readDriverIncidents(pool, query, f.timezone);
    expect(second.rows).toHaveLength(5); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.rows, ...second.rows].map(r => r.id)).size).toBe(55);
    query.set("driverId", b.driverId);
    await expect(readDriverIncidents(pool, query, f.timezone)).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  } finally { await f.close(); }
}, 120_000);
