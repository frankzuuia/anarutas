import { randomUUID } from "node:crypto";
import { readdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { migrate } from "../src/core/database";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import { reportProductIncidentWithPhotos, readProductIncidentEvidence } from "../src/core/product-incidents-evidence";
import { readProductIncidents, reportProductIncident } from "../src/core/product-incidents";
import { cleanIncidentEvidence } from "../src/core/driver-incident-evidence";
import { productIncidentsWorkbook } from "../src/core/product-incidents-excel";
import ExcelJS from "exceljs";

it("stores twelve independent incidents on the same open order with three immutable private photos each", async () => {
  const f = await executionFixture();
  try {
    await f.start();
    const state = () => readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
    const initial = await state(), stop = initial.stops[0], shipment = stop.shipmentIds[0];
    const identity = async () => {
      const route = await state(), current = route.stops[0];
      return { commandId: randomUUID(), executionId: route.id, publicationRevision: route.publicationRevision,
        executionRevision: route.revision, stopVersion: current.version, visitSequence: current.visitSequence,
        orderVersion: current.orderStates[0].version, policyVersion: route.policy.version };
    };
    await executeStopCommand(f.db.pool, f.members[0].authorization, f.planId, stop.id, "arrival", {
      ...await identity(), sample: { latitude: 20.64, longitude: -103.4, accuracyMeters: 5, ageMilliseconds: 0,
        capturedAt: f.now.toISOString(), mock: false },
    }, f.timezone, f.now);
    const photos = await Promise.all(["#126633", "#4488aa", "#aabb22"].map(async background => ({
      contentType: "image/jpeg", bytes: await sharp({ create: { width: 32, height: 24, channels: 3, background } }).jpeg().toBuffer(),
    })));
    const root = join(f.photoRoot, "incident-evidence");
    const run = (raw: Record<string, unknown>, files = photos, authorization = f.members[0].authorization) =>
      reportProductIncidentWithPhotos(f.db.pool, authorization, f.planId, stop.id, shipment, raw, f.timezone, files, f.photoRoot, f.now);
    const form = { formVersion: 2, concept: "Picking", comments: ["customer_specifications", "order_quantity_changed"],
      department: "Ventas", note: "Notas del chofer", lineIndex: 0, quantity: "0.01", kind: "replacement_quality" };
    const input = { ...await identity(), ...form };
    await expect(run(input, [...photos, photos[0]])).rejects.toMatchObject({ code: "INVALID_PRODUCT_PHOTO_COUNT" });
    await expect(run(input, [photos[0], { bytes: Buffer.from("bad"), contentType: "image/jpeg" }])).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
    await expect(run(input, photos, f.members[1].authorization)).rejects.toMatchObject({ status: 404 });
    expect(await readdir(root)).toEqual([]);
    const first = await run(input);
    const replay = await run(input); expect(replay.duplicate).toBe(true); expect(replay.incidentId).toBe(first.incidentId);
    await expect(run(input, photos.slice(0, 2))).rejects.toMatchObject({ code: "COMMAND_REUSED" });
    await expect(run(input, [...photos].reverse())).rejects.toMatchObject({ code: "COMMAND_REUSED" });
    expect(await readdir(root)).toHaveLength(3);
    for (let index = 1; index < 12; index++) await run({ ...await identity(), ...form,
      kind: index % 2 ? "return" : "replacement_wrong_product" });
    const current = await state();
    expect(current.stops[0].orderStates[0].status).toBe("open");
    expect(current.stops[0].productIncidents).toHaveLength(12);
    const report = await readProductIncidents(f.db.pool, f.actor,
      new URLSearchParams({ from: "2026-09-24", to: "2026-09-24" }), f.timezone);
    expect(report.rows).toHaveLength(12);
    expect(await readdir(root)).toHaveLength(36);
    for (const incident of report.rows) {
      expect(incident.evidenceIds).toHaveLength(3);
      expect(incident.department).toBe("Ventas"); expect(incident.concept).toBe("Picking");
      expect(incident.note).toBe("No cumple con las especificaciones del cliente\nSe modificó la cantidad en la orden\nNotas del chofer");
      expect(incident.snapshot).toMatchObject({ reportedConcept: "Picking", reportedDepartment: "Ventas", additionalNote: "Notas del chofer" });
      for (const photoId of incident.evidenceIds!) expect((await sharp(await readProductIncidentEvidence(
        f.db.pool, f.actor, incident.id, f.photoRoot, photoId)).metadata()).format).toBe("webp");
    }
    const firstRow = report.rows[0], secondRow = report.rows[1];
    await expect(readProductIncidentEvidence(f.db.pool, f.actor, firstRow.id, f.photoRoot, secondRow.evidenceIds![1])).rejects.toMatchObject({ status: 404 });
    await expect(readProductIncidentEvidence(f.db.pool, randomUUID(), firstRow.id, f.photoRoot, firstRow.evidenceIds![1])).rejects.toMatchObject({ status: 401 });
    await expect(readProductIncidentEvidence(f.db.pool, f.actor, firstRow.id, f.photoRoot, "../bad")).rejects.toThrow();
    for (const statement of ["DELETE FROM route_product_incident_photos WHERE incident_id=$1", "UPDATE route_product_incident_photos SET position=position WHERE incident_id=$1"])
      await expect(f.db.pool.query(statement, [firstRow.id])).rejects.toMatchObject({ code: "42501" });
    await expect(f.db.pool.query(`INSERT INTO route_product_incident_photos VALUES($1,4,$2,$3,10)`,
      [firstRow.id, randomUUID(), "a".repeat(64)])).rejects.toMatchObject({ code: "23514" });
    await expect(f.db.pool.query(`INSERT INTO route_product_incident_photos VALUES($1,2,$2,$3,10)`,
      [firstRow.id, firstRow.evidenceId, "a".repeat(64)])).rejects.toMatchObject({ code: "23514" });
    await expect(run({ ...await identity(), ...form, quantity: "2" })).rejects.toMatchObject({ code: "INCIDENT_QUANTITY_EXCEEDED" });
    expect(await readdir(root)).toHaveLength(36);
    const old = new Date(Date.now() - 72 * 3600_000);
    for (const file of await readdir(root)) await utimes(join(root, file), old, old);
    await cleanIncidentEvidence(f.db.pool, f.photoRoot); expect(await readdir(root)).toHaveLength(36);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await productIncidentsWorkbook(report.rows) as never);
    const sheet = workbook.getWorksheet("Incidencias")!;
    expect(sheet.rowCount).toBe(13); expect(sheet.columnCount).toBe(9);
    expect(sheet.getCell("H2").value).toBe(firstRow.note);
    expect(JSON.stringify(sheet.model)).not.toContain("Picking");
    const manual = await reportProductIncident(f.db.pool, f.members[0].authorization, f.planId, stop.id, shipment,
      { ...await identity(), ...form, kind: "shortage_validation", lineIndex: null, product: "Faltante manual", unit: "kg" }, f.timezone, f.now);
    await expect(f.db.pool.query(`INSERT INTO route_product_incident_photos VALUES($1,2,$2,$3,10)`,
      [manual.incidentId, randomUUID(), "a".repeat(64)])).rejects.toMatchObject({ code: "23514" });
  } finally { await f.close(); }
}, 120_000);

it("upgrades v27 non-destructively and serializes repeated v28 installation", async () => {
  const f = await executionFixture();
  try {
    await f.start();
    const state = () => readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
    const identity = async () => {
      const route = await state(), stop = route.stops[0];
      return { commandId: randomUUID(), executionId: route.id, publicationRevision: route.publicationRevision,
        executionRevision: route.revision, stopVersion: stop.version, visitSequence: stop.visitSequence,
        orderVersion: stop.orderStates[0].version, policyVersion: route.policy.version };
    };
    const stop = (await state()).stops[0];
    await executeStopCommand(f.db.pool, f.members[0].authorization, f.planId, stop.id, "arrival", {
      ...await identity(), sample: { latitude: 20.64, longitude: -103.4, accuracyMeters: 5, ageMilliseconds: 0,
        capturedAt: f.now.toISOString(), mock: false },
    }, f.timezone, f.now);
    const legacy = { ...await identity(), kind: "return", lineIndex: 0, department: "Operaciones", quantity: "0.25", note: "APK anterior" };
    const photo = { contentType: "image/jpeg", bytes: await sharp({ create: { width: 16, height: 16, channels: 3, background: "#33aa44" } }).jpeg().toBuffer() };
    const report = () => reportProductIncidentWithPhotos(f.db.pool, f.members[0].authorization, f.planId, stop.id,
      stop.shipmentIds[0], legacy, f.timezone, [photo], f.photoRoot, f.now);
    const saved = await report();
    if (!saved.incidentId) throw new Error("The legacy command must return its incident receipt");
    const original = (await f.db.pool.query("SELECT * FROM route_product_incidents WHERE id=$1", [saved.incidentId])).rows[0];
    await f.db.pool.query("DROP TABLE route_product_incident_photos; UPDATE rutas_installation SET schema_version=27");
    await Promise.all([migrate(f.db.pool, f.db.config.instanceId), migrate(f.db.pool, f.db.config.instanceId)]);
    expect((await f.db.pool.query("SELECT schema_version FROM rutas_installation")).rows[0].schema_version).toBe(33);
    expect((await f.db.pool.query("SELECT count(*) FROM route_shipments")).rows[0].count).toBe("4");
    expect((await f.db.pool.query("SELECT * FROM route_product_incidents WHERE id=$1", [saved.incidentId])).rows[0]).toEqual(original);
    const replay = await report(); expect(replay.duplicate).toBe(true); expect(replay.incidentId).toBe(saved.incidentId);
    expect(await readdir(join(f.photoRoot, "incident-evidence"))).toHaveLength(1);
    expect((await sharp(await readProductIncidentEvidence(f.db.pool, f.actor, saved.incidentId, f.photoRoot)).metadata()).format).toBe("webp");
  } finally { await f.close(); }
}, 120_000);
