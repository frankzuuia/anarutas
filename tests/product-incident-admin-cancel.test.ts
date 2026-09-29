import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import { executeDriverOrderCommand } from "../src/core/driver-order-command";
import { reportCustomerClosed } from "../src/core/driver-closed-command";
import { reportProductIncidentWithEvidence } from "../src/core/product-incidents-evidence";
import { changeProductIncident, classifyProductIncident, readProductIncidents, resolveProductIncident } from "../src/core/product-incidents";
import { cancelProductIncidentByAdmin } from "../src/core/product-incident-admin-cancel";
import { migrate } from "../src/core/database";
import { migrateProductIncidentAmendments } from "../src/core/product-incident-amendments-schema";
import { createUser } from "../src/core/auth";

async function prepare() {
  const f = await executionFixture();
  try {
    await f.start();
    const auth = f.members[0].authorization;
    const state = () => readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
    const identity = async () => {
      const route = await state(), stop = route.stops[0];
      return { commandId: randomUUID(), executionId: route.id, publicationRevision: route.publicationRevision,
        executionRevision: route.revision, stopVersion: stop.version, visitSequence: stop.visitSequence,
        orderVersion: stop.orderStates[0].version, policyVersion: route.policy.version };
    };
    const stop = (await state()).stops[0], shipment = stop.shipmentIds[0];
    await executeStopCommand(f.db.pool, auth, f.planId, stop.id, "arrival", {
      ...await identity(), sample: { latitude: 20.64, longitude: -103.4, accuracyMeters: 5,
        ageMilliseconds: 0, capturedAt: f.now.toISOString(), mock: false },
    }, f.timezone, f.now);
    const photo = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#abcdef" } }).jpeg().toBuffer();
    const report = async () => reportProductIncidentWithEvidence(f.db.pool, auth, f.planId, stop.id, shipment,
      { ...await identity(), kind: "replacement_quality", lineIndex: 0, quantity: "1", department: "Operaciones" },
      f.timezone, photo, "image/jpeg", f.photoRoot, f.now);
    const remove = (id: string, version = 1, actor = f.actor) => cancelProductIncidentByAdmin(f.db.pool, actor, id, { expectedVersion: version });
    const day = new URLSearchParams({ from: "2026-09-24", to: "2026-09-24" });
    return { f, auth, state, identity, stop, shipment, photo, report, remove, day };
  } catch (error) { await f.close(); throw error; }
}

it("administration cancels open pending or resolved incidents with authorization, CAS, replay and retained evidence", async () => {
  const { f, report, remove, day, state } = await prepare();
  try {
    const incident = (await report()).incidentId!;
    await expect(remove(incident, 1, randomUUID())).rejects.toMatchObject({ status: 401 });
    await expect(remove(incident, 1, f.members[0].driverId)).rejects.toMatchObject({ status: 401 });
    await f.db.pool.query("UPDATE route_users SET active=false WHERE id=$1", [f.actor]);
    await expect(remove(incident)).rejects.toMatchObject({ status: 401 });
    await f.db.pool.query("UPDATE route_users SET active=true WHERE id=$1", [f.actor]);
    await expect(remove(randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(remove(incident, 2)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const before = await state();
    expect(await remove(incident)).toEqual({ canceled: true, duplicate: false, version: 2 });
    expect(await remove(incident)).toEqual({ canceled: true, duplicate: true, version: 2 });
    const otherAdmin = await createUser(f.db.pool, f.actor, { name: "Otro administrador", login: `admin-${randomUUID()}`, password: randomUUID() });
    await expect(remove(incident, 1, otherAdmin.id)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const after = await state();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.stops[0].version).toBe(before.stops[0].version + 1);
    expect(after.stops[0].orderStates[0].version).toBe(before.stops[0].orderStates[0].version + 1);
    expect(after.stops[0].productIncidents.find(i => i.id === incident)).toMatchObject({ status: "canceled", reportRemoved: true });
    await expect(remove(incident, 2)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const second = (await report()).incidentId!;
    await resolveProductIncident(f.db.pool, f.actor, second, { expectedVersion: 1, note: "Reposición atendida" });
    expect(await remove(second, 2)).toMatchObject({ version: 3 });
    for (const mode of ["history", "live", "export"] as const)
      expect(await readProductIncidents(f.db.pool, f.actor, day, f.timezone, mode)).toEqual({ rows: [], pending: 0, nextCursor: null });
    const record = (await f.db.pool.query("SELECT * FROM route_product_incidents WHERE id=$1", [second])).rows[0];
    expect(record).toMatchObject({ canceled_by: null, canceled_by_admin: f.actor, report_removed_by: f.actor, status: "canceled" });
    expect(record.evidence_id).toBeTruthy();
    const audit = (await f.db.pool.query("SELECT * FROM route_product_incident_changes WHERE incident_id=$1 ORDER BY id DESC LIMIT 1", [second])).rows[0];
    expect(audit.actor_id).toBe(f.actor);
    expect(audit.before_record).toMatchObject({ status: "resolved", resolution_note: "Reposición atendida" });
    expect((await f.db.pool.query("SELECT details FROM route_audit WHERE entity_id=$1 AND action='product_incident.canceled'", [incident])).rows)
      .toEqual([{ details: { previousStatus: "pending", executionId: before.id, shipmentId: before.stops[0].shipmentIds[0], reportOnly: false, orderStatus: "open" } }]);
  } finally { await f.close(); }
}, 120_000);

it.each(["delivered", "rescheduled"])("administration only removes the report after order is %s, preserving driver quantities and closure", async terminal => {
  const { f, report, remove, auth, identity, stop, shipment, state, photo, day } = await prepare();
  try {
    const incident = (await report()).incidentId!;
    await resolveProductIncident(f.db.pool, f.actor, incident, { expectedVersion: 1, note: "Atendido" });
    if (terminal === "rescheduled") await reportCustomerClosed(f.db.pool, auth, f.planId, stop.id,
      await identity(), photo, "image/jpeg", f.timezone, f.photoRoot, f.now);
    await executeDriverOrderCommand(f.db.pool, auth, f.planId, stop.id, shipment,
      { ...await identity(), kind: terminal === "delivered" ? "deliver" : "reschedule", note: "Cierre QA", productIncidentsAcknowledged: true }, f.timezone, f.now);
    const before = await state();
    const original = (await f.db.pool.query("SELECT * FROM route_product_incidents WHERE id=$1", [incident])).rows[0];
    expect(await remove(incident, 2)).toMatchObject({ duplicate: false, version: 3 });
    expect(await remove(incident, 2)).toMatchObject({ duplicate: true, version: 3 });
    await expect(remove(incident, 3)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const after = await state();
    expect(after.revision).toBe(before.revision);
    expect(after.stops[0].version).toBe(before.stops[0].version);
    expect(after.stops[0].orderStates).toEqual(before.stops[0].orderStates);
    expect(after.stops[0].orderStates[0].status).toBe(terminal);
    expect(after.stops[0].productIncidents.find(i => i.id === incident))
      .toMatchObject({ status: "resolved", quantity: "1.000000", reportRemoved: true });
    const stored = (await f.db.pool.query("SELECT * FROM route_product_incidents WHERE id=$1", [incident])).rows[0];
    for (const key of ["quantity", "status", "source_quantity", "resolved_at", "resolved_by", "resolution_note", "evidence_id", "snapshot"])
      expect(stored[key]).toEqual(original[key]);
    expect(stored.canceled_at).toBeNull(); expect(stored.canceled_by_admin).toBeNull();
    for (const mode of ["history", "live", "export"] as const)
      expect(await readProductIncidents(f.db.pool, f.actor, day, f.timezone, mode)).toEqual({ rows: [], pending: 0, nextCursor: null });
    await expect(classifyProductIncident(f.db.pool, f.actor, incident, { expectedVersion: 3, department: "Ventas", concept: "Picking" }))
      .rejects.toMatchObject({ code: "INCIDENT_CANCELED" });
    await expect(resolveProductIncident(f.db.pool, f.actor, incident, { expectedVersion: 3, note: "Otra resolución" }))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await f.db.pool.query("SELECT details FROM route_audit WHERE entity_id=$1 AND action='product_incident.canceled'", [incident])).rows[0].details)
      .toMatchObject({ reportOnly: true, orderStatus: terminal });
  } finally { await f.close(); }
}, 120_000);

it("admin and driver cancellation serialize, and v29 migration retains the original driver canceler", async () => {
  const { f, report, remove, auth, identity, stop, shipment } = await prepare();
  try {
    const legacy = (await report()).incidentId!;
    await changeProductIncident(f.db.pool, auth, f.planId, stop.id, shipment, legacy, { ...await identity(), expectedVersion: 1 }, "cancel");
    await f.db.pool.query("ALTER TABLE route_product_incidents DROP COLUMN canceled_by_admin, DROP COLUMN report_removed_at, DROP COLUMN report_removed_by");
    await migrateProductIncidentAmendments(f.db.pool);
    await migrate(f.db.pool, f.db.config.instanceId);
    expect((await f.db.pool.query("SELECT schema_version FROM rutas_installation")).rows[0].schema_version).toBe(30);
    expect((await f.db.pool.query("SELECT status,canceled_by,canceled_by_admin FROM route_product_incidents WHERE id=$1", [legacy])).rows[0])
      .toEqual({ status: "canceled", canceled_by: f.members[0].driverId, canceled_by_admin: null });
    await expect(remove(legacy, 2)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const target = (await report()).incidentId!;
    const data = { ...await identity(), expectedVersion: 1 };
    const results = await Promise.allSettled([remove(target), changeProductIncident(f.db.pool, auth, f.planId, stop.id, shipment, target, data, "cancel")]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "VERSION_CONFLICT" } });
    expect((await f.db.pool.query("SELECT count(*) FROM route_product_incident_changes WHERE incident_id=$1", [target])).rows[0].count).toBe("1");
    const closingTarget = (await report()).incidentId!;
    const closing = { ...await identity(), kind: "deliver", productIncidentsAcknowledged: true };
    const race = await Promise.allSettled([remove(closingTarget), executeDriverOrderCommand(f.db.pool, auth,
      f.planId, stop.id, shipment, closing, f.timezone, f.now)]);
    expect(race[0].status).toBe("fulfilled");
    const final = (await f.db.pool.query(`SELECT i.status,i.quantity::text,i.report_removed_at,o.status AS order_status
      FROM route_product_incidents i JOIN route_driver_execution_orders o ON o.execution_id=i.execution_id
      AND o.shipment_id=i.shipment_id WHERE i.id=$1`, [closingTarget])).rows[0];
    expect(final.report_removed_at).toBeTruthy();
    expect(final.quantity).toBe("1.000000");
    if (race[1].status === "fulfilled") expect(final).toMatchObject({ order_status: "delivered", status: "pending" });
    else {
      expect(race[1]).toMatchObject({ reason: { code: "VERSION_CONFLICT" } });
      expect(final).toMatchObject({ order_status: "open", status: "canceled" });
    }
  } finally { await f.close(); }
}, 120_000);
