import { randomUUID } from "node:crypto";
import { mkdir, readdir, rmdir, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand, exitDriverVisit } from "../src/core/driver-stop-command";
import { executeDriverOrderCommand } from "../src/core/driver-order-command";
import { reportCustomerClosed } from "../src/core/driver-closed-command";
import { addDriverCustomerPhone } from "../src/core/driver-customer-phone";
import { readDriverPlan } from "../src/core/driver-mobile-route";
import { readDriverCommandResult } from "../src/core/driver-command-receipts";
import { cleanIncidentEvidence, readIncidentEvidence } from "../src/core/driver-incident-evidence";
import { readLiveIncidents, resolveLiveIncident } from "../src/core/driver-live-incidents";

type Fixture = Awaited<ReturnType<typeof executionFixture>>;
async function state(f: Fixture) { return readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone); }
async function identity(f: Fixture, index = 0) {
  const route = await state(f), stop = route.stops[index];
  return { commandId: randomUUID(), executionId: route.id, publicationRevision: route.publicationRevision,
    executionRevision: route.revision, stopVersion: stop.version, visitSequence: stop.visitSequence,
    policyVersion: route.policy.version };
}
async function arrive(f: Fixture, index = 0) {
  const route = await state(f);
  await executeStopCommand(f.db.pool, f.members[0].authorization, f.planId, route.stops[index].id, "arrival", {
    ...await identity(f, index), sample: { latitude: 20.64, longitude: -103.4, accuracyMeters: 5,
      ageMilliseconds: 0, capturedAt: f.now.toISOString(), mock: false },
  }, f.timezone, f.now);
}
async function service(f: Fixture, index: number, orderIndex: number, action: Record<string, unknown>) {
  const stop = (await state(f)).stops[index], order = stop.orderStates[orderIndex];
  const input = { ...await identity(f, index), orderVersion: order.version, ...action };
  const run = (raw: Record<string, unknown> = input, authorization = f.members[0].authorization) => executeDriverOrderCommand(f.db.pool,
    authorization, f.planId, stop.id, order.shipmentId, raw, f.timezone, f.now);
  return { run, input, order, stop };
}
const filters = () => new URLSearchParams({ from: "2026-09-24", to: "2026-09-24" });
async function report(f: Fixture) { return readLiveIncidents(f.db.pool, f.actor, filters(), f.timezone, f.now); }
async function photo() { return sharp({ create: { width: 24, height: 24, channels: 3, background: "#abcdef" } }).jpeg().toBuffer(); }

it("rejects independently, authenticates, serializes replays and later delivers without erasing history", async () => {
  const f = await executionFixture({ groupFourthOrderWithFirst: true });
  try {
    await f.start();
    await arrive(f);
    const command = await service(f, 0, 0, { kind: "reject", reasonCode: "other", note: "Cliente no lo requiere hoy" });
    await expect(command.run(command.input, "Bearer invalid")).rejects.toMatchObject({ status: 401 });
    await expect(command.run(command.input, f.members[1].authorization)).rejects.toMatchObject({ status: 404 });
    for (const key of ["executionRevision", "publicationRevision", "stopVersion", "orderVersion"]) {
      await expect(command.run({ ...command.input, [key]: 999 })).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    }
    await expect(command.run({ ...command.input, visitSequence: 99 })).rejects.toMatchObject({ code: "VISIT_NOT_ACTIVE", status: 409 });
    const [first, replay] = await Promise.all([command.run(), command.run()]);
    expect(first.incidentId).toBe(replay.incidentId);
    expect([first.duplicate, replay.duplicate].sort()).toEqual([false, true]);
    expect(await readDriverCommandResult(f.db.pool, f.members[0].authorization, f.planId, command.input.commandId))
      .toMatchObject({ confirmed: true, result: { incidentId: first.incidentId } });
    expect(await readDriverCommandResult(f.db.pool, f.members[0].authorization, f.planId, randomUUID()))
      .toEqual({ confirmed: false, result: null });
    await expect(readDriverCommandResult(f.db.pool, null, f.planId, command.input.commandId)).rejects.toMatchObject({ status: 401 });
    await f.start(f.members[1]);
    expect(await readDriverCommandResult(f.db.pool, f.members[1].authorization, f.planId, command.input.commandId))
      .toEqual({ confirmed: false, result: null });
    await expect(command.run({ ...command.input, note: "Otro" })).rejects.toMatchObject({ code: "COMMAND_REUSED" });
    let current = await state(f);
    expect(current.stops[0].orderStates.map(order => order.status).sort()).toEqual(["open", "rejected"]);
    const live = await report(f);
    expect(live.metrics).toEqual({ pending: 1, completed: 0, resolved: 0 });
    expect(live.rows[0]).toMatchObject({ kind: "order_rejected", canResolve: true, note: "Cliente no lo requiere hoy" });
    expect((await readLiveIncidents(f.db.pool, f.actor, new URLSearchParams({ ...Object.fromEntries(filters()), driverId: f.members[1].driverId }), f.timezone, f.now)).rows).toHaveLength(0);
    await resolveLiveIncident(f.db.pool, f.actor, first.incidentId!, { expectedVersion: 1 }, f.now);
    expect((await report(f)).metrics.resolved).toBe(1);
    current = await state(f);
    await exitDriverVisit(f.db.pool, f.members[0].authorization, f.planId, current.stops[0].id, await identity(f), f.timezone, f.now);
    const inactive = await service(f, 0, 0, { kind: "deliver" });
    await expect(inactive.run()).rejects.toMatchObject({ code: "VISIT_NOT_ACTIVE" });
    await arrive(f);
    const delivery = await service(f, 0, 0, { kind: "deliver" });
    await delivery.run();
    expect((await state(f)).stops[0].orderStates[0].status).toBe("delivered");
    expect((await report(f)).metrics).toEqual({ pending: 0, completed: 1, resolved: 0 });
    expect((await f.db.pool.query("SELECT kind FROM route_driver_incident_events WHERE incident_id=$1", [first.incidentId])).rows.map(row => row.kind))
      .toEqual(expect.arrayContaining(["opened", "resolved_by_admin", "completed"]));
    expect((await delivery.run()).duplicate).toBe(true);
    await expect((await service(f, 0, 0, { kind: "deliver" })).run()).rejects.toMatchObject({ code: "ORDER_STATE_CONFLICT" });
  } finally { await f.close(); }
}, 120_000);

it("requires a real photo, retries both orders, restores abandoned cases and reprograms without a date", async () => {
  const f = await executionFixture({ groupFourthOrderWithFirst: true });
  try {
    await f.start(); await arrive(f);
    const stop = (await state(f)).stops[0], input = { ...await identity(f), note: "Cortina cerrada" }, bytes = await photo();
    const closed = (raw = input, data = bytes) => reportCustomerClosed(f.db.pool, f.members[0].authorization,
      f.planId, stop.id, raw, data, "image/jpeg", f.timezone, f.photoRoot, f.now);
    await expect(closed(input, Buffer.from("not an image"))).rejects.toMatchObject({ code: "UNIT_PHOTO_INVALID" });
    expect((await report(f)).rows).toHaveLength(0);
    const saved = await closed();
    expect((await closed()).incidentId).toBe(saved.incidentId);
    expect(await readdir(join(f.photoRoot, "incident-evidence"))).toHaveLength(1);
    expect((await state(f)).stops[0].orderStates.map(order => order.status)).toEqual(["closed_pending", "closed_pending"]);
    let live = await report(f);
    expect(live.rows[0]).toMatchObject({ canResolve: false, kind: "customer_closed", status: "active" });
    expect(live.rows[0].orders).toHaveLength(2);
    await expect((await service(f, 0, 0, { kind: "deliver" })).run()).rejects.toMatchObject({ code: "RETRY_REQUIRES_NEW_ARRIVAL" });
    const evidenceId = live.rows[0].evidenceId!;
    expect((await readIncidentEvidence(f.db.pool, f.actor, evidenceId, f.photoRoot, f.now)).length).toBeGreaterThan(0);
    await expect(readIncidentEvidence(f.db.pool, randomUUID(), evidenceId, f.photoRoot, f.now)).rejects.toMatchObject({ status: 401 });
    await expect(resolveLiveIncident(f.db.pool, f.actor, saved.incidentId!, { expectedVersion: 1 }, f.now)).rejects.toMatchObject({ code: "DRIVER_RETRY_REQUIRED" });
    await expect(closed({ ...await identity(f), note: "Cortina cerrada" })).rejects.toMatchObject({ code: "RETRY_REQUIRES_NEW_ARRIVAL" });
    await exitDriverVisit(f.db.pool, f.members[0].authorization, f.planId, stop.id, await identity(f), f.timezone, f.now);
    expect((await report(f)).metrics.pending).toBe(1);
    await arrive(f);
    expect((await report(f)).metrics.pending).toBe(0);
    await exitDriverVisit(f.db.pool, f.members[0].authorization, f.planId, stop.id, await identity(f), f.timezone, f.now);
    expect((await report(f)).metrics.pending).toBe(1);
    await arrive(f);
    await (await service(f, 0, 0, { kind: "deliver" })).run();
    const reschedule = await service(f, 0, 1, { kind: "reschedule", note: "Coordinar con encargado" });
    await expect(reschedule.run({ ...reschedule.input, date: "2026-09-25" })).rejects.toMatchObject({ code: "RESCHEDULE_HAS_NO_DATE" });
    const reprogrammed = await reschedule.run();
    live = await report(f);
    expect(live.rows.map(row => row.kind)).toEqual(["rescheduled"]);
    expect(live.rows[0]).toMatchObject({ canResolve: true, note: "Coordinar con encargado" });
    await expect(readIncidentEvidence(f.db.pool, f.actor, evidenceId, f.photoRoot, f.now)).rejects.toMatchObject({ status: 404 });
    expect(await cleanIncidentEvidence(f.db.pool, f.photoRoot, f.now)).toBe(1);
    expect(await readdir(join(f.photoRoot, "incident-evidence"))).toHaveLength(0);
    await resolveLiveIncident(f.db.pool, f.actor, reprogrammed.incidentId!, { expectedVersion: 1 }, f.now);
    expect((await resolveLiveIncident(f.db.pool, f.actor, reprogrammed.incidentId!, { expectedVersion: 1 }, f.now)).duplicate).toBe(true);
    expect((await state(f)).stops[0].orderStates.map(order => order.status)).toEqual(["delivered", "rescheduled"]);
    await expect((await service(f, 0, 1, { kind: "deliver" })).run()).rejects.toMatchObject({ code: "ORDER_STATE_CONFLICT" });
    expect((await f.db.pool.query("SELECT count(*)::int n FROM route_plans")).rows[0].n).toBe(1);
    expect((await f.db.pool.query("SELECT kind FROM route_driver_incident_events WHERE incident_id=$1", [saved.incidentId])).rows.map(row => row.kind))
      .toEqual(expect.arrayContaining(["retry_arrived", "retry_abandoned", "handled", "evidence_expired"]));
  } finally { await f.close(); }
}, 120_000);

it("expires files at 24h without deleting audit and adds only a missing operational phone", async () => {
  const f = await executionFixture();
  try {
    await f.start(); await arrive(f);
    const stop = (await state(f)).stops[0];
    const phoneInput = { ...await identity(f), phone: "+52 33 9000 2851", customerVersion: stop.customerVersion };
    await addDriverCustomerPhone(f.db.pool, f.members[0].authorization, f.planId, stop.id, phoneInput, f.now);
    expect((await addDriverCustomerPhone(f.db.pool, f.members[0].authorization, f.planId, stop.id, phoneInput, f.now)).duplicate).toBe(true);
    expect((await state(f)).stops[0].phone).toBe("+523390002851");
    const mobilePlan = await readDriverPlan(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
    expect(mobilePlan.orders.find((order: { id: string }) => order.id === stop.shipmentIds[0]).phone).toBe("+523390002851");
    const published = (await f.db.pool.query("SELECT snapshot FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2", [f.planId, f.members[0].vehicleId])).rows[0].snapshot;
    expect(published.orders.find((order: { id: string }) => order.id === stop.shipmentIds[0]).phone).not.toBe("+523390002851");
    const customer = (await f.db.pool.query("SELECT phone,phone_overridden,version FROM route_customers WHERE id=$1", [stop.customerId])).rows[0];
    expect(customer.phone_overridden).toBe(true);
    await expect(addDriverCustomerPhone(f.db.pool, f.members[0].authorization, f.planId, stop.id,
      { ...await identity(f), phone: "3311111111", customerVersion: customer.version }, f.now)).rejects.toMatchObject({ code: "CUSTOMER_PHONE_ALREADY_SET" });
    await reportCustomerClosed(f.db.pool, f.members[0].authorization, f.planId, stop.id, await identity(f), await photo(), "image/jpeg", f.timezone, f.photoRoot, f.now);
    const evidenceId = (await report(f)).rows[0].evidenceId!;
    const deadline = new Date(f.now.getTime() + 24 * 60 * 60 * 1000);
    expect((await readIncidentEvidence(f.db.pool, f.actor, evidenceId, f.photoRoot, new Date(deadline.getTime() - 1))).length).toBeGreaterThan(0);
    await expect(readIncidentEvidence(f.db.pool, f.actor, evidenceId, f.photoRoot, deadline)).rejects.toMatchObject({ status: 404 });
    expect(await cleanIncidentEvidence(f.db.pool, f.photoRoot, deadline)).toBe(1);
    expect(await cleanIncidentEvidence(f.db.pool, f.photoRoot, deadline)).toBe(0);
    expect(await readdir(join(f.photoRoot, "incident-evidence"))).toHaveLength(0);
    expect((await f.db.pool.query("SELECT count(*)::int n FROM route_driver_service_incidents")).rows[0].n).toBe(1);
  } finally { await f.close(); }
}, 120_000);

it("denies stale ownership/visit writes and serializes conflicting commands without partial delivery", async () => {
  const f = await executionFixture();
  try {
    await f.start(); await arrive(f);
    const command = await service(f, 0, 0, { kind: "reject", reasonCode: "poor_quality" });
    await expect(command.run({ ...command.input, executionId: randomUUID() })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(executeDriverOrderCommand(f.db.pool, f.members[0].authorization, f.planId, randomUUID(),
      command.order.shipmentId, command.input, f.timezone, f.now)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(executeDriverOrderCommand(f.db.pool, f.members[0].authorization, f.planId, command.stop.id,
      randomUUID(), command.input, f.timezone, f.now)).rejects.toMatchObject({ status: 404 });
    const results = await Promise.allSettled([command.run(), command.run({ ...command.input, commandId: randomUUID(), kind: "deliver", reasonCode: null })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "VERSION_CONFLICT" } });
    expect((await f.db.pool.query("SELECT count(*)::int n FROM route_driver_stop_events WHERE kind IN ('delivery','rejection')")).rows[0].n).toBe(1);
    const active = (await state(f)).stops[0];
    await expect(addDriverCustomerPhone(f.db.pool, f.members[0].authorization, f.planId, active.id,
      { ...await identity(f), phone: "3311111111", customerVersion: active.customerVersion + 1 }, f.now)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await f.db.pool.query("UPDATE route_customers SET archived_at=$2 WHERE id=$1", [active.customerId, f.now]);
    await expect(addDriverCustomerPhone(f.db.pool, f.members[0].authorization, f.planId, active.id,
      { ...await identity(f), phone: "3311111111", customerVersion: active.customerVersion }, f.now)).rejects.toMatchObject({ code: "CUSTOMER_UNAVAILABLE" });
  } finally { await f.close(); }
}, 120_000);

it("retries failed evidence deletion, recovers missing files and removes only old unreferenced photos", async () => {
  const f = await executionFixture();
  try {
    await f.start(); await arrive(f);
    const stop = (await state(f)).stops[0];
    await reportCustomerClosed(f.db.pool, f.members[0].authorization, f.planId, stop.id, await identity(f),
      await photo(), "image/jpeg", f.timezone, f.photoRoot, f.now);
    const root = join(f.photoRoot, "incident-evidence");
    const evidenceId = (await report(f)).rows[0].evidenceId!;
    const path = join(root, `${evidenceId}.webp`);
    await unlink(path);
    await mkdir(path); // A real filesystem failure, not an unlink mock.
    await expect(readIncidentEvidence(f.db.pool, f.actor, evidenceId, f.photoRoot, f.now)).rejects.toMatchObject({ status: 404 });
    const expired = new Date(f.now.getTime() + 24 * 60 * 60 * 1000);
    expect(await cleanIncidentEvidence(f.db.pool, f.photoRoot, expired)).toBe(0);
    expect((await f.db.pool.query("SELECT removed_at FROM route_driver_incident_evidence WHERE id=$1", [evidenceId])).rows[0].removed_at).toBeNull();
    await rmdir(path); // Remove only the empty test directory; next pass sees ENOENT.
    expect(await cleanIncidentEvidence(f.db.pool, f.photoRoot, expired)).toBe(1);
    const old = join(root, `${randomUUID()}.webp`), young = join(root, `${randomUUID()}.webp`), unrelated = join(root, "keep.txt");
    for (const candidate of [old, young, unrelated]) await writeFile(candidate, "private fixture");
    await utimes(old, f.now, f.now); await utimes(unrelated, f.now, f.now); await utimes(young, expired, expired);
    expect(await cleanIncidentEvidence(f.db.pool, f.photoRoot, expired)).toBe(0);
    const remaining = await readdir(root);
    expect(remaining).toHaveLength(2); expect(remaining).toContain("keep.txt");
    expect(remaining).not.toContain(old.slice(root.length + 1));
    expect((await f.db.pool.query("SELECT count(*)::int n FROM route_driver_incident_events WHERE kind='evidence_expired'")).rows[0].n).toBe(1);
  } finally { await f.close(); }
}, 120_000);
