import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import ExcelJS from "exceljs";
import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { migrate } from "../src/core/database";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import { changeProductIncident, classifyProductIncident, readProductIncidents, reportProductIncident } from "../src/core/product-incidents";
import { reportProductIncidentWithPhotos, readProductIncidentEvidence } from "../src/core/product-incidents-evidence";
import { incidentConcepts, productFormInput, productCommentsByKind, supportedProductFormVersion } from "../src/core/product-incident-form";
import { incidentClassificationInput, productIncidentInput, productIncidentDetail, reportableProductIncidentKinds } from "../src/core/product-incidents-policy";
import { productPhotosBody } from "../src/server/product-photos-body";
import { productIncidentsWorkbook } from "../src/core/product-incidents-excel";
import { createUser } from "../src/core/auth";

it("IO05/09/10: v3 catalogs are per kind; v2 receipts keep their exact representation", () => {
  const v2 = { formVersion: 2, concept: "Picking", comments: ["product_not_ordered", "special"], note: " Nota " };
  expect(productFormInput(v2)).toEqual({ formVersion: 2, concept: "Picking", comments: ["special", "product_not_ordered"],
    additionalNote: "Nota", note: "Especiales\nNo venía el producto en el pedido\nNota" });
  expect(productFormInput({ note: "Old" })).toBeUndefined();
  expect(() => productFormInput({ ...v2, concept: "Error en compra" })).toThrow("INVALID_PRODUCT_FORM");
  expect(() => productFormInput({ ...v2, comments: ["poor_quality"] })).toThrow("INVALID_PRODUCT_FORM");
  for (const value of [undefined, null, 0, 1, 4, "3", {}, []]) expect(supportedProductFormVersion(value)).toBe(false);
  for (const value of [2, 3]) expect(supportedProductFormVersion(value)).toBe(true);
  const all = Object.values(productCommentsByKind).flat();
  for (const [kind, allowed] of Object.entries(productCommentsByKind)) {
    const raw = { formVersion: 3, kind, concept: kind === "return" ? null : "Error en compra", comments: [...allowed].reverse(), note: "Detalles" };
    const form = productFormInput(raw)!;
    expect(form.comments).toEqual(allowed);
    expect(form.concept).toBe(raw.concept);
    expect(form.additionalNote).toBe("Detalles");
    for (const code of all.filter(code => !(allowed as readonly string[]).includes(code)))
      expect(() => productFormInput({ ...raw, comments: [code] })).toThrow("INVALID_PRODUCT_FORM");
    for (const comments of [null, undefined, "special", {}, [1], ["constructor"], [allowed[0], allowed[0]]])
      expect(() => productFormInput({ ...raw, comments })).toThrow("INVALID_PRODUCT_FORM");
    if (kind !== "return") for (const concept of incidentConcepts)
      expect(productFormInput({ ...raw, concept })?.concept).toBe(concept);
  }
  for (const kind of [null, undefined, "constructor", "unknown", 3, {}])
    expect(() => productFormInput({ formVersion: 3, kind, concept: "Picking", comments: [] })).toThrow("INVALID_PRODUCT_FORM");
  const returned = { formVersion: 3, kind: "return", lineIndex: 0, quantity: ".25", comments: ["poor_quality"] };
  const validReturn = { ...returned, quantity: "0.25" };
  expect(productIncidentInput(validReturn)).toMatchObject({ department: null, concept: null, note: "Mala calidad", formVersion: 3 });
  expect(productIncidentInput({ ...validReturn, department: null, concept: null })).toMatchObject({ department: null, concept: null });
  for (const department of ["Operaciones", "", 0, false, {}, []])
    expect(() => productIncidentInput({ ...validReturn, department })).toThrow("INVALID_INCIDENT_DEPARTMENT");
  for (const concept of ["Picking", "", 0, false, {}, []])
    expect(() => productIncidentInput({ ...validReturn, concept })).toThrow("INVALID_PRODUCT_FORM");
  const missing = { formVersion: 3, kind: "shortage_warehouse", department: "Compras", concept: "Error en compra",
    warehouseReason: "product_not_ordered", comments: [], product: "Acelga", unit: "kg", quantity: "1" };
  expect(productIncidentInput(missing)).toMatchObject({ warehouseReason: "product_not_ordered", concept: "Error en compra" });
  expect(productIncidentDetail("shortage_warehouse", "product_not_ordered")).toBe("No venía el producto en el pedido");
  for (const concept of [null, undefined, "", "Otro", 3]) expect(() => productIncidentInput({ ...missing, concept })).toThrow();
});

it("IO12/14: administrative comments are optional, bounded, and never accept financial edits", () => {
  const classification = { department: "Compras", concept: "Error en compra" };
  expect(incidentClassificationInput(classification)).toEqual(classification);
  expect(incidentClassificationInput({ ...classification, comment: " Texto \n válido " })).toEqual({ ...classification, comment: "Texto \n válido" });
  for (const comment of [null, "", "  ", "a".repeat(2000), "😀".repeat(2000)])
    expect(incidentClassificationInput({ ...classification, comment }).comment).toBe(typeof comment === "string" ? comment.trim() : null);
  for (const comment of [1, false, [], {}, "a".repeat(2001), "\u0000"])
    expect(() => incidentClassificationInput({ ...classification, comment })).toThrow("INVALID_SERVICE_NOTE");
  for (const key of ["quantity", "kind", "status", "actor", "replacementPayment", "financial"])
    expect(() => incidentClassificationInput({ ...classification, [key]: "bad" })).toThrow("INVALID_PRODUCT_INCIDENT");
});

it("IO08: actual multipart transport accepts versions 2/3 with all three photos", async () => {
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#229933" } }).jpeg().toBuffer();
  for (const formVersion of [2, 3]) {
    const data = new FormData(); data.set("command", JSON.stringify({ formVersion }));
    for (let i = 0; i < 3; i++) data.append("photos", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), `${i}.jpg`);
    const result = await productPhotosBody(new Request("http://localhost/incidents", { method: "POST", body: data }));
    expect(result.raw).toEqual({ formVersion }); expect(result.photos).toHaveLength(3);
    expect(result.photos.every(photo => photo.bytes.equals(bytes))).toBe(true);
  }
});

it("IO01–14/32: real migration, v3 capture, four-type export and concurrent audited comments preserve driver and financial data", async () => {
  const f = await executionFixture();
  try {
    // Reconstruct the real previous schema in this isolated DB only.
    await f.db.pool.query(`DROP VIEW IF EXISTS route_incident_live_entries; DROP TABLE IF EXISTS route_incident_notifications,route_incident_alert_settings; DROP TABLE route_product_incident_annotations;
      ALTER TABLE route_product_incidents DROP CONSTRAINT route_product_incidents_warehouse_reason_check;
      ALTER TABLE route_product_incidents ADD CONSTRAINT route_product_incidents_warehouse_reason_check
        CHECK(warehouse_reason IN ('special','quality','late_arrival'));
      UPDATE rutas_installation SET schema_version=45`);
    await Promise.all([migrate(f.db.pool, f.db.config.instanceId), migrate(f.db.pool, f.db.config.instanceId)]);
    expect((await f.db.pool.query("SELECT schema_version FROM rutas_installation")).rows[0].schema_version).toBe(48);
    expect((await f.db.pool.query("SELECT count(*)::int n FROM pg_constraint WHERE conrelid='route_product_incident_annotations'::regclass AND contype='f'")).rows[0].n).toBe(2);
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
      ...(await identity()), sample: { latitude: 20.64, longitude: -103.4, accuracyMeters: 5, ageMilliseconds: 0,
        capturedAt: f.now.toISOString(), mock: false },
    }, f.timezone, f.now);
    const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#1f9923" } }).jpeg().toBuffer();
    const photos = Array.from({ length: 3 }, () => ({ bytes, contentType: "image/jpeg" }));
    const run = (raw: Record<string, unknown>) => reportProductIncidentWithPhotos(f.db.pool, f.members[0].authorization,
      f.planId, stop.id, shipment, raw, f.timezone, photos, f.photoRoot, f.now);
    const returnCommand = { ...(await identity()), formVersion: 3, kind: "return", lineIndex: 0,
      quantity: "0.25", comments: ["poor_quality", "damaged_product"], note: "Envase roto" };
    await expect(reportProductIncident(f.db.pool, f.members[0].authorization, f.planId, stop.id, shipment,
      returnCommand, f.timezone, f.now)).rejects.toMatchObject({ code: "PRODUCT_EVIDENCE_REQUIRED" });
    const returned = await run(returnCommand);
    expect((await run(returnCommand)).duplicate).toBe(true);
    for (const kind of reportableProductIncidentKinds) {
      const manual = kind.startsWith("shortage");
      await run({ ...(await identity()), formVersion: 3, kind, department: "Compras", concept: "Error en compra",
        quantity: "0.25", comments: kind === "shortage_validation" ? ["late_arrival"] : ["product_not_ordered"], note: "Original",
        ...(manual ? { product: "Faltante", unit: "kg" } : { lineIndex: 0 }),
        ...(kind === "shortage_warehouse" ? { warehouseReason: "product_not_ordered" } : {}),
      });
    }
    const day = new URLSearchParams({ from: "2026-09-24", to: "2026-09-24" });
    const read = (mode: "history" | "live" | "export" = "history") => readProductIncidents(f.db.pool, f.actor, day, f.timezone, mode);
    for (const mode of ["history", "export"] as const) {
      const report = await read(mode);
      expect(report.rows.map(row => row.kind).sort()).toEqual([...reportableProductIncidentKinds].sort());
      expect(report.pending).toBe(4);
    }
    const readTimes: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now(); await read(); readTimes.push(performance.now() - started);
    }
    readTimes.sort((a, b) => a - b);
    await writeFile(".local/io-read-latency.json", JSON.stringify({ metric: "incident_report_read", samples: readTimes.length, rows: 4,
      p50Ms: readTimes[9], p95Ms: readTimes[18], environment: "isolated PostgreSQL, sequential reads" }, null, 2));
    const returnedRow = (await state()).stops[0].productIncidents.find(row => row.id === returned.incidentId)!;
    expect(returnedRow).toMatchObject({ department: null, concept: null, quantity: "0.250000", comments: ["poor_quality", "damaged_product"] });
    expect((await readProductIncidentEvidence(f.db.pool, f.actor, returned.incidentId!, f.photoRoot)).length).toBeGreaterThan(0);
    const replacement = (await read()).rows.find(row => row.kind === "replacement_quality")!;
    const base = { expectedVersion: 1, department: "Ventas", concept: "Picking" };
    await expect(classifyProductIncident(f.db.pool, f.actor, returned.incidentId!, base)).rejects.toMatchObject({ status: 404 });
    await expect(classifyProductIncident(f.db.pool, randomUUID(), replacement.id, base)).rejects.toMatchObject({ status: 401 });
    await expect(classifyProductIncident(f.db.pool, f.actor, randomUUID(), base)).rejects.toMatchObject({ status: 404 });
    const second = await createUser(f.db.pool, f.actor, { name: "Second admin", login: `io-${randomUUID()}`, password: randomUUID() });
    const settlement = await createUser(f.db.pool, f.actor, { name: "Settlement", login: `io-${randomUUID()}`, password: randomUUID(), role: "settlement" });
    await expect(classifyProductIncident(f.db.pool, settlement.id, replacement.id, base)).rejects.toMatchObject({ status: 403 });
    await expect(readProductIncidents(f.db.pool, settlement.id, day, f.timezone)).rejects.toMatchObject({ status: 403 });
    const financialBefore = await state();
    const before = (await f.db.pool.query("SELECT to_jsonb(p)-ARRAY['version','department','concept'] AS record FROM route_product_incidents p WHERE id=$1", [replacement.id])).rows[0].record;
    const results = await Promise.allSettled([
      classifyProductIncident(f.db.pool, f.actor, replacement.id, { ...base, comment: "Corrección uno" }),
      classifyProductIncident(f.db.pool, second.id, replacement.id, { ...base, comment: "Corrección dos" }),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "VERSION_CONFLICT" } });
    const annotation = (await f.db.pool.query("SELECT * FROM route_product_incident_annotations WHERE incident_id=$1", [replacement.id])).rows[0];
    expect([f.actor, second.id]).toContain(annotation.updated_by);
    for (const mode of ["history", "live", "export"] as const)
      expect((await read(mode)).rows.find(row => row.id === replacement.id)).toMatchObject({ note: annotation.comment, originalNote: replacement.note, version: 2 });
    const after = (await f.db.pool.query("SELECT to_jsonb(p)-ARRAY['version','department','concept'] AS record FROM route_product_incidents p WHERE id=$1", [replacement.id])).rows[0].record;
    expect(after).toEqual(before);
    const financialAfter = await state();
    expect(financialAfter.revision).toBe(financialBefore.revision);
    expect(financialAfter.stops[0].orderStates).toEqual(financialBefore.stops[0].orderStates);
    const audit = (await f.db.pool.query("SELECT actor_id,details FROM route_audit WHERE entity_id=$1 AND action='product_incident.classified'", [replacement.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: annotation.updated_by, details: { before: { comment: null }, after: { comment: annotation.comment } } });
    expect((await f.db.pool.query("SELECT actor_id FROM route_product_incident_changes WHERE incident_id=$1", [replacement.id])).rows).toEqual([{ actor_id: annotation.updated_by }]);
    // Old admin UI omits comment; it must preserve the newer administrative text.
    await classifyProductIncident(f.db.pool, f.actor, replacement.id, { ...base, expectedVersion: 2 });
    expect((await read()).rows.find(row => row.id === replacement.id)?.note).toBe(annotation.comment);
    // Explicit empty is different from clearing the override (null).
    await classifyProductIncident(f.db.pool, f.actor, replacement.id, { ...base, expectedVersion: 3, comment: "" });
    expect((await read()).rows.find(row => row.id === replacement.id)?.note).toBe("");
    await classifyProductIncident(f.db.pool, f.actor, replacement.id, { ...base, expectedVersion: 4, comment: null });
    expect((await read()).rows.find(row => row.id === replacement.id)?.note).toBe(replacement.note);
    await classifyProductIncident(f.db.pool, f.actor, replacement.id, { ...base, expectedVersion: 5, comment: "=texto seguro" });
    const report = await read("export");
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await productIncidentsWorkbook(report.rows) as never);
    const sheet = workbook.getWorksheet("Incidencias")!;
    expect(sheet.rowCount).toBe(5); expect(sheet.columnCount).toBe(9);
    expect(sheet.getRow(1).values).toEqual([undefined, "Fecha", "Cliente", "Producto", "Cantidad", "Unidad", "Departamento", "Detalle de la incidencia", "Comentarios", "Orden"]);
    const index = report.rows.findIndex(row => row.id === replacement.id) + 2;
    expect(sheet.getCell(`H${index}`).value).toBe("'=texto seguro");
    // A subsequent driver amendment keeps both the new original and the admin override.
    await changeProductIncident(f.db.pool, f.members[0].authorization, f.planId, stop.id, shipment, replacement.id,
      { ...(await identity()), expectedVersion: 6, formVersion: 3, kind: "replacement_quality", lineIndex: 0, quantity: "0.25",
        department: "Compras", concept: "Error en compra", comments: [], note: "Chofer amplió información" }, "amend");
    expect((await read()).rows.find(row => row.id === replacement.id)).toMatchObject({ note: "=texto seguro", originalNote: "Chofer amplió información" });
    await migrate(f.db.pool, f.db.config.instanceId);
    expect((await f.db.pool.query("SELECT count(*)::int n FROM route_product_incidents")).rows[0].n).toBe(5);
    expect((await f.db.pool.query("SELECT count(*)::int n FROM route_product_incident_annotations")).rows[0].n).toBe(1);
  } finally { await f.close(); }
}, 120_000);
