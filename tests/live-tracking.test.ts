import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createUser } from "../src/core/auth";
import { executionFixture } from "./helpers/driver-execution";
import { cancelPublishedRoute } from "../src/core/route-publications";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import { readLiveRoutes } from "../src/core/live-routes";
import { readControlLayout, saveControlLayout, writeLiveTracking } from "../src/core/live-tracking";
import { controlScreens, stopProgress, trackingSample } from "../src/core/live-tracking-policy";

describe("tracking policy", () => {
  it("keeps delivery and internal rescheduling separate", () => {
    expect(stopProgress(["delivered", "rescheduled"])).toMatchObject({ visible: false, delivered: 1, rescheduled: 1, remaining: 0 });
    expect(stopProgress(["open", "closed_pending", "rejected"])).toMatchObject({ visible: true, pending: 2, remaining: 3, status: "incident" });
    expect(stopProgress(["delivered", "open"])).toMatchObject({ pending: 0, status: "open" });
    expect(stopProgress(["rescheduled"]).status).toBe("rescheduled");
    expect(stopProgress(["delivered"]).status).toBe("delivered");
    expect(stopProgress([]).visible).toBe(true);
  });
  it("validates samples without coercion, fake GPS or stale queues", () => {
    const sample = { latitude: 90, longitude: -180, accuracyMeters: 0, ageMilliseconds: 120000, mock: false };
    expect(trackingSample(sample)).toMatchObject({ latitude: 90, longitude: -180 });
    expect(trackingSample(null)).toBeNull();
    for (const bad of [undefined, [], 1, Object.assign(() => undefined, sample), Object.assign([], sample), { ...sample, mock: true }, { ...sample, latitude: 91 },
      { ...sample, longitude: -181 }, { ...sample, accuracyMeters: -1 }, { ...sample, latitude: "20" },
      { ...sample, ageMilliseconds: 120001 }, { ...sample, ageMilliseconds: -1 }, { ...sample, latitude: NaN }]) {
      expect(() => trackingSample(bad)).toThrow("INVALID_TRACKING_SAMPLE");
    }
  });
  it("allows independent duplicates but rejects recursive/unknown screens and duplicate identities", () => {
    const screen = { id: randomUUID(), type: "routes", driverId: "", vehicleId: "" };
    expect(controlScreens([screen])).toEqual([screen]);
    const withVehicle = { ...screen, driverId: randomUUID(), vehicleId: randomUUID() };
    expect(controlScreens([withVehicle])).toEqual([withVehicle]);
    expect(controlScreens(Array.from({ length: 32 }, () => ({ ...screen, id: randomUUID() })))).toHaveLength(32);
    expect(controlScreens([screen, { ...screen, id: randomUUID(), driverId: randomUUID() }])).toHaveLength(2);
    expect(controlScreens([{ ...screen, type: "panel:customers" }])[0].type).toBe("panel:customers");
    for (const raw of [null, [null], [Object.assign(() => undefined, screen)], [Object.assign([], screen)], [screen, screen], [{ ...screen, type: "control_center" }],
      Array.from({ length: 33 }, () => ({ ...screen, id: randomUUID() }))]) {
      expect(() => controlScreens(raw)).toThrow("INVALID_CONTROL_LAYOUT");
    }
    expect(() => controlScreens([{ ...screen, driverId: "bad" }])).toThrow("INVALID_INPUT");
    expect(() => controlScreens([{ ...screen, vehicleId: "bad" }])).toThrow("INVALID_INPUT");
  });
});

describe("real tracking and control center PostgreSQL", () => {
  let f: Awaited<ReturnType<typeof executionFixture>>;
  let execution: Awaited<ReturnType<typeof readDriverExecution>>;
  let identity: { sessionId: string; executionId: string; publicationRevision: number };
  const post = (raw: Record<string, unknown>, member = 0) => writeLiveTracking(f.db.pool, f.members[member].authorization, f.planId, { ...identity, ...raw });
  beforeAll(async () => {
    f = await executionFixture(); await f.start(); await f.start(f.members[1]);
    execution = await readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
    identity = { sessionId: randomUUID(), executionId: execution.id, publicationRevision: execution.publicationRevision };
  }, 120000);
  afterAll(async () => { await f?.close(); });
  it("starts idempotently, accepts only owned targets and ordered GPS without changing execution", async () => {
    for (const kind of ["unknown", ["sample"], ["begin"], {}, null])
      await expect(post({ kind, sequence: 1, sample: null, targetStopId: null })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await post({ kind: "begin" }); await post({ kind: "begin" });
    const sample = { latitude: 20.65, longitude: -103.4, accuracyMeters: 8, ageMilliseconds: 0, mock: false };
    await expect(post({ kind: "sample", sequence: 1, targetStopId: randomUUID(), sample })).rejects.toMatchObject({ code: "INVALID_TRACKING_TARGET" });
    await expect(post({ kind: "sample", sequence: 1, targetStopId: execution.stops[0].id, sample })).resolves.toMatchObject({ accepted: true });
    await expect(post({ kind: "sample", sequence: 1, targetStopId: null, sample: { ...sample, latitude: 0 } })).resolves.toMatchObject({ accepted: false });
    const row = (await readLiveRoutes(f.db.pool, f.actor)).routes.find(r => r.id === execution.id)!;
    expect(row.location?.latitude).toBe(20.65); expect(row.targetStopId).toBe(execution.stops[0].id);
    expect(row.progress).toMatchObject({ orders: 3, delivered: 0, remainingStops: 3 });
    expect((await readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone)).revision).toBe(execution.revision);
    await expect(post({ kind: "sample", sequence: 2, targetStopId: null, sample: null }, 1)).rejects.toMatchObject({ code: "TRACKING_SESSION_CHANGED" });
  });
  it("never rejuvenates GPS with heartbeat and fences old sessions", async () => {
    const before = (await readLiveRoutes(f.db.pool, f.actor)).routes.find(r => r.id === execution.id)!.location!.observedAt;
    await post({ kind: "sample", sequence: 2, targetStopId: null, sample: null });
    expect((await readLiveRoutes(f.db.pool, f.actor)).routes.find(r => r.id === execution.id)!.location!.observedAt).toBe(before);
    await post({ kind: "sample", sequence: 3, targetStopId: null,
      sample: { latitude: 0, longitude: 0, accuracyMeters: 80, ageMilliseconds: 90000, mock: false } });
    expect((await readLiveRoutes(f.db.pool, f.actor)).routes.find(r => r.id === execution.id)!.location!.observedAt).toBe(before);
    const old = identity.sessionId; identity.sessionId = randomUUID(); await post({ kind: "begin" });
    expect((await readLiveRoutes(f.db.pool, f.actor)).routes.find(r => r.id === execution.id)!.location).toBeNull();
    await expect(post({ kind: "begin", sessionId: old })).rejects.toMatchObject({ code: "TRACKING_SESSION_CHANGED" });
    await expect(post({ kind: "sample", sessionId: old, sequence: 9, targetStopId: null, sample: null })).rejects.toMatchObject({ code: "TRACKING_SESSION_CHANGED" });
    const sample = { latitude: 20.65, longitude: -103.4, accuracyMeters: 8, ageMilliseconds: 0, mock: false };
    await Promise.all([post({ kind: "sample", sequence: 2, targetStopId: null, sample: { ...sample, latitude: 21 } }),
      post({ kind: "sample", sequence: 1, targetStopId: null, sample })]);
    expect((await readLiveRoutes(f.db.pool, f.actor)).routes.find(r => r.id === execution.id)!.location!.latitude).toBe(21);
    await post({ kind: "stop", sequence: 3 });
    expect((await readLiveRoutes(f.db.pool, f.actor)).routes.find(r => r.id === execution.id)!.location).toMatchObject({ stopped: true, latitude: 21 });
    await expect(post({ kind: "sample", sequence: 4, targetStopId: null, sample: null })).rejects.toMatchObject({ code: "TRACKING_SESSION_CHANGED" });
  });
  it("preserves per-user layout and rejects concurrent stale saves", async () => {
    expect(await readControlLayout(f.db.pool, f.actor)).toEqual({ screens: null, version: 0 });
    const screens = [{ id: randomUUID(), type: "routes", driverId: f.members[0].driverId, vehicleId: "" },
      { id: randomUUID(), type: "routes", driverId: f.members[1].driverId, vehicleId: "" }];
    const results = await Promise.allSettled([saveControlLayout(f.db.pool, f.actor, { screens, expectedVersion: 0 }), saveControlLayout(f.db.pool, f.actor, { screens: [], expectedVersion: 0 })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const saved = await readControlLayout(f.db.pool, f.actor); expect(saved.version).toBe(1);
    await expect(saveControlLayout(f.db.pool, randomUUID(), { screens, expectedVersion: 0 })).rejects.toMatchObject({ status: 401 });
    await saveControlLayout(f.db.pool, f.actor, { screens, expectedVersion: 1 });
    expect((await readControlLayout(f.db.pool, f.actor)).screens).toEqual(screens);
    const other = await createUser(f.db.pool, f.actor, { name: "Otro administrador", login: `qa-${randomUUID()}`, password: randomUUID() });
    expect(await readControlLayout(f.db.pool, other.id)).toEqual({ screens: null, version: 0 });
    await saveControlLayout(f.db.pool, other.id, { screens: [], expectedVersion: 0 });
    expect((await readControlLayout(f.db.pool, f.actor)).screens).toEqual(screens);
  });
  it("projects actual arrival and repoint without guessing a destination", async () => {
    const read = () => readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
    const report = async () => (await readLiveRoutes(f.db.pool, f.actor)).routes.find(r => r.id === execution.id)!;
    const gps = { latitude: 20.64, longitude: -103.4, accuracyMeters: 5, ageMilliseconds: 0, capturedAt: f.now.toISOString(), mock: false };
    const command = async (kind: "arrival" | "repoint", extra: Record<string, unknown> = {}) => {
      const current = await read(), stop = current.stops[0];
      return executeStopCommand(f.db.pool, f.members[0].authorization, f.planId, stop.id, kind, {
        commandId: randomUUID(), executionId: current.id, publicationRevision: current.publicationRevision,
        executionRevision: current.revision, stopVersion: stop.version, policyVersion: current.policy.version,
        customerLocationVersion: stop.customerLocationVersion, sample: gps, ...extra,
      }, f.timezone, f.now);
    };
    expect((await report()).arrivedStopId).toBeNull();
    await command("arrival");
    expect((await report()).arrivedStopId).toBe(execution.stops[0].id);
    await command("repoint", { point: { latitude: 20.6403, longitude: -103.4 },
      address: { street: "Calle corregida 2", neighborhood: "Centro", postalCode: "44100", city: "Guadalajara" } });
    const corrected = await report();
    expect(corrected.corrected).toBe(true); expect(corrected.polylines).toEqual([]);
    expect(corrected.stops[0]).toMatchObject({ latitude: 20.6403, address: "Calle corregida 2, Col. Centro, C.P. 44100, Guadalajara" });
    expect(corrected.targetStopId).toBeNull();
  });
  it("hides cancelled publications and blocks revoked credentials", async () => {
    await f.db.pool.query("UPDATE route_driver_mobile_sessions SET revoked_at=now() WHERE device_id=$1", [f.members[0].deviceId]);
    await expect(post({ kind: "begin", sessionId: randomUUID() })).rejects.toMatchObject({ status: 401 });
    const plan = (await f.db.pool.query("SELECT version FROM route_plans WHERE id=$1", [f.planId])).rows[0];
    await cancelPublishedRoute(f.db.pool, f.actor, f.planId, f.members[0].vehicleId, { expectedVersion: plan.version, expectedRevision: 1 });
    expect((await readLiveRoutes(f.db.pool, f.actor)).routes.some(r => r.id === execution.id)).toBe(false);
  });
});
