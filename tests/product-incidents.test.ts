import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand, exitDriverVisit } from "../src/core/driver-stop-command";
import { reportCustomerClosed } from "../src/core/driver-closed-command";
import { reportProductIncident, readProductIncidents, resolveProductIncident, classifyProductIncident } from "../src/core/product-incidents";
import { incidentQuantity, incidentClassificationInput, isReplacement, productIncidentClassification, productIncidentInput, productIncidentDetail, requireProductEvidence } from "../src/core/product-incidents-policy";
import { reportProductIncidentWithEvidence } from "../src/core/product-incidents-evidence";
import { archiveWeeklyPlans, weeklyPlanCutoff } from "../src/core/plan-archive";
import { listPlans, createPlan } from "../src/core/plans";
import { readDriverPlan } from "../src/core/driver-mobile-route";
import { executeDriverOrderCommand } from "../src/core/driver-order-command";
import { migrate } from "../src/core/database";

it("validates positive exact decimals and product identity by kind", () => {
  for (const kind of ["replacement_quality", "replacement_wrong_product", "return"] as const) {
    expect(() => requireProductEvidence(kind, false)).toThrow("PRODUCT_EVIDENCE_REQUIRED");
    expect(() => requireProductEvidence(kind, true)).not.toThrow();
  }
  for (const kind of ["shortage_validation", "shortage_warehouse"] as const)
    for (const present of [true, false]) expect(() => requireProductEvidence(kind, present)).not.toThrow();
  for (const value of [0, -1, NaN, Infinity, null, undefined, {}, true, "1e2", ".2", "1.", "1.0000001", "1000000000000", "", " ", "-1", "0.000000"])
    expect(() => incidentQuantity(value)).toThrow("INVALID_INCIDENT_QUANTITY");
  for (const [input, output] of [["0002.500000", "2.5"], ["0.000001", "0.000001"], [2, "2"], [" 1.2 ", "1.2"], ["999999999999.999999", "999999999999.999999"]])
    expect(incidentQuantity(input)).toBe(output);
  const linked = { kind: "return", lineIndex: 0, quantity: "0.25", department: "Operaciones" };
  expect(productIncidentInput(linked)).toEqual({ kind: "return", lineIndex: 0, quantity: "0.25", product: null, unit: null, note: null, warehouseReason: null, department: "Operaciones" });
  for (const lineIndex of [-1, 0.5, null, undefined, "0", NaN]) expect(() => productIncidentInput({ ...linked, lineIndex })).toThrow("INVALID_PRODUCT_INCIDENT");
  for (const kind of ["__proto__", "constructor", "", "other", null, 2, ["return"]]) expect(() => productIncidentInput({ ...linked, kind })).toThrow("INVALID_PRODUCT_INCIDENT");
  for (const extra of [{ product: "Override" }, { unit: "kg" }]) expect(() => productIncidentInput({ ...linked, ...extra })).toThrow("INVALID_PRODUCT_INCIDENT");
  for (const kind of ["shortage_validation", "shortage_warehouse"]) {
    const manual = { kind, product: " Limón ", unit: " kg ", quantity: "2", department: "Compras", note: " pendiente ", warehouseReason: kind === "shortage_warehouse" ? "quality" : null };
    expect(productIncidentInput(manual)).toMatchObject({ product: "Limón", unit: "kg", note: "pendiente", lineIndex: null });
    expect(productIncidentInput({ ...manual, lineIndex: null }).lineIndex).toBeNull();
    expect(() => productIncidentInput({ ...manual, lineIndex: 0 })).toThrow("INVALID_PRODUCT_INCIDENT");
    for (const [field, limit] of [["product", 300], ["unit", 40]] as const) {
      for (const value of [undefined, null, "", "  ", 2, "a\n", "a".repeat(limit + 1)])
        expect(() => productIncidentInput({ ...manual, [field]: value })).toThrow("INVALID_PRODUCT_INCIDENT");
      expect(productIncidentInput({ ...manual, [field]: "a".repeat(limit) })[field]).toHaveLength(limit);
      expect(productIncidentInput({ ...manual, [field]: ` ${"a".repeat(limit)} ` })[field]).toHaveLength(limit);
    }
  }
  for (const department of [undefined, null, "", "Ventas", {}, 1]) expect(() => productIncidentInput({ ...linked, department })).toThrow("INVALID_INCIDENT_DEPARTMENT");
  for (const warehouseReason of ["unknown", "", null, undefined, {}, 1, "constructor", ["quality"]])
    expect(() => productIncidentInput({ ...linked, kind: "shortage_warehouse", lineIndex: null, warehouseReason })).toThrow("INVALID_WAREHOUSE_REASON");
  expect(() => productIncidentInput({ ...linked, warehouseReason: "quality" })).toThrow("INVALID_WAREHOUSE_REASON");
  for (const reason of ["special", "quality", "late_arrival"] as const) {
    expect(productIncidentInput({ kind: "shortage_warehouse", product: "P", unit: "kg", department: "Compras", quantity: "1", warehouseReason: reason }).warehouseReason).toBe(reason);
    expect(productIncidentDetail("shortage_warehouse", reason)).toBe({ special: "Especiales", quality: "Calidad", late_arrival: "Llegada tardía" }[reason]);
  }
  expect(productIncidentDetail("shortage_warehouse", null)).toBe("Faltante desde bodega");
  expect(productIncidentDetail("shortage_validation", null)).toBe("Validación");
  expect(productIncidentDetail("replacement_quality", null)).toBe("Calidad");
  expect(productIncidentDetail("replacement_wrong_product", null)).toBe("Producto erróneo");
  expect(productIncidentDetail("return", null)).toBe("Devolución");
  expect(productIncidentDetail("return", "quality")).toBe("Devolución");
  expect(incidentClassificationInput({ department: " Compras ", concept: " Especiales " })).toEqual({ department: "Compras", concept: "Especiales" });
  expect(() => incidentClassificationInput({ department: "", concept: "Especiales" })).toThrow();
  expect(() => incidentClassificationInput({ department: "Compras", concept: "" })).toThrow();
  expect(productIncidentClassification("shortage_validation", "Operaciones")).toEqual({ department: "Operaciones", concept: "Reparto" });
  expect(productIncidentClassification("shortage_warehouse", "Compras")).toEqual({ department: "Compras", concept: null });
  expect(productIncidentClassification("shortage_validation", "Compras")).toEqual({ department: "Compras", concept: null });
  for (const kind of ["replacement_quality", "replacement_wrong_product", "return"] as const) {
    expect(productIncidentClassification(kind, "Operaciones")).toEqual({ department: "Operaciones", concept: null });
    expect(isReplacement(kind)).toBe(kind !== "return");
    expect(productIncidentInput({ ...linked, kind }).kind).toBe(kind);
  }
  expect(isReplacement("shortage_validation")).toBe(false);
});

it("cuts at Sunday 20:00 local including timezone, year rollover and catch-up", () => {
  const zone = "America/Mexico_City";
  expect(weeklyPlanCutoff(zone, new Date("2026-09-28T01:59:59Z"))).toBe("2026-09-21");
  expect(weeklyPlanCutoff(zone, new Date("2026-09-28T02:00:00Z"))).toBe("2026-09-28");
  expect(weeklyPlanCutoff(zone, new Date("2026-09-28T15:00:00Z"))).toBe("2026-09-28");
  expect(weeklyPlanCutoff("UTC", new Date("2026-09-27T19:59:59Z"))).toBe("2026-09-21");
  expect(weeklyPlanCutoff("UTC", new Date("2026-09-27T20:00:00Z"))).toBe("2026-09-28");
  expect(weeklyPlanCutoff("UTC", new Date("2027-01-01T12:00:00Z"))).toBe("2026-12-28");
});

it("records real product incidents atomically, scopes access, preserves replacements and archives without deleting", async () => {
  const f = await executionFixture();
  try {
    await f.start();
    const state = () => readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
    const identity = async () => {
      const r = await state(), s = r.stops[0];
      return { commandId: randomUUID(), executionId: r.id, publicationRevision: r.publicationRevision,
        executionRevision: r.revision, stopVersion: s.version, visitSequence: s.visitSequence, orderVersion: s.orderStates[0].version };
    };
    const initial = await state(), stop = initial.stops[0], shipment = stop.shipmentIds[0];
    const photo = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#abcdef" } }).jpeg().toBuffer();
    const run = (raw: Record<string, unknown>, auth = f.members[0].authorization, shipmentId = shipment) =>
      raw.lineIndex !== undefined
        ? reportProductIncidentWithEvidence(f.db.pool, auth, f.planId, stop.id, shipmentId, raw, f.timezone, photo, "image/jpeg", f.photoRoot, f.now)
        : reportProductIncident(f.db.pool, auth, f.planId, stop.id, shipmentId, raw, f.timezone, f.now);
    const input = { ...await identity(), visitSequence: 1, kind: "replacement_quality", department: "Operaciones", lineIndex: 0, quantity: "0.75", note: "No cumple calidad" };
    await expect(run(input)).rejects.toMatchObject({ code: "VISIT_NOT_ACTIVE" });
    await executeStopCommand(f.db.pool, f.members[0].authorization, f.planId, stop.id, "arrival", {
      ...await identity(), policyVersion: initial.policy.version,
      sample: { latitude: 20.64, longitude: -103.4, accuracyMeters: 5, ageMilliseconds: 0, capturedAt: f.now.toISOString(), mock: false },
    }, f.timezone, f.now);
    const command = { ...input, ...await identity() };
    await expect(run(command, "Bearer invalid")).rejects.toMatchObject({ status: 401 });
    await expect(run(command, f.members[1].authorization)).rejects.toMatchObject({ status: 404 });
    await expect(run(command, f.members[0].authorization, randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(run({ ...command, lineIndex: 999 })).rejects.toMatchObject({ code: "INVALID_PRODUCT_LINE" });
    await expect(run({ ...command, quantity: "2.000001" })).rejects.toMatchObject({ code: "INCIDENT_QUANTITY_EXCEEDED" });
    await expect(run({ ...command, orderVersion: 999 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const [a, b] = await Promise.all([run(command), run(command)]);
    expect(a.incidentId).toBe(b.incidentId);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    await expect(run({ ...command, quantity: "0.5" })).rejects.toMatchObject({ code: "COMMAND_REUSED" });
    await expect(run({ ...command, commandId: randomUUID() })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(run({ ...command, ...await identity(), quantity: "1.250001" })).rejects.toMatchObject({ code: "INCIDENT_QUANTITY_EXCEEDED" });
    await run({ ...command, ...await identity(), kind: "return", quantity: "1.25" });
    for (const kind of ["shortage_validation", "shortage_warehouse"]) await run({ ...await identity(), kind, department: "Compras", product: "Producto ausente", unit: "Pza", quantity: "3", note: "No vino", warehouseReason: kind === "shortage_warehouse" ? "special" : null });
    expect((await state()).stops[0].productIncidents).toHaveLength(4);
    const params = new URLSearchParams({ from: "2026-09-24", to: "2026-09-24" });
    const read = (p = params, mode: "history" | "live" | "export" = "history") => readProductIncidents(f.db.pool, f.actor, p, f.timezone, mode);
    expect((await read()).rows).toHaveLength(4);
    expect((await read()).rows.find(i => i.kind === "shortage_warehouse")).toMatchObject({ department: "Compras", concept: null, date: "2026-09-24" });
    expect((await read(new URLSearchParams({ driverId: f.members[1].driverId }), "live")).rows).toHaveLength(0);
    expect((await read(new URLSearchParams(), "live")).rows).toHaveLength(1);
    const deliver = { ...await identity(), kind: "deliver" };
    await expect(executeDriverOrderCommand(f.db.pool, f.members[0].authorization, f.planId, stop.id, shipment, deliver, f.timezone, f.now))
      .rejects.toMatchObject({ code: "PRODUCT_INCIDENTS_ACK_REQUIRED" });
    await executeDriverOrderCommand(f.db.pool, f.members[0].authorization, f.planId, stop.id, shipment,
      { ...deliver, productIncidentsAcknowledged: true }, f.timezone, f.now);
    expect((await read(new URLSearchParams(), "live")).rows).toHaveLength(1);
    await expect(run({ ...command, ...await identity() })).rejects.toMatchObject({ code: "ORDER_STATE_CONFLICT" });
    const future = await createPlan(f.db.pool, f.actor, { date: "2026-09-28", label: "Lunes" });
    const counts = async () => (await f.db.pool.query(`SELECT (SELECT count(*) FROM route_shipments) AS shipments,
      (SELECT count(*) FROM route_driver_stop_events) AS events, (SELECT count(*) FROM route_product_incidents) AS incidents,
      (SELECT count(*) FROM route_plan_publications) AS publications`)).rows[0];
    const before = await counts();
    const archived = await Promise.all([archiveWeeklyPlans(f.db.pool, f.timezone, new Date("2026-09-28T02:00:00Z")),
      archiveWeeklyPlans(f.db.pool, f.timezone, new Date("2026-09-28T02:00:00Z"))]);
    expect(archived.map(r => r.archived).sort()).toEqual([0, 1]);
    expect(await counts()).toEqual(before);
    expect((await listPlans(f.db.pool)).map(p => p.id)).toEqual([future.id]);
    expect((await readDriverPlan(f.db.pool, f.members[0].driverId, f.planId, f.timezone)).orders).toHaveLength(3);
    const replacement = (await read(new URLSearchParams(), "live")).rows[0];
    await expect(classifyProductIncident(f.db.pool, randomUUID(), replacement.id, { expectedVersion: 1, department: "Operaciones", concept: "Picking" })).rejects.toMatchObject({ status: 401 });
    await classifyProductIncident(f.db.pool, f.actor, replacement.id, { expectedVersion: 1, department: "Operaciones", concept: "Picking" });
    await expect(classifyProductIncident(f.db.pool, f.actor, replacement.id, { expectedVersion: 1, department: "Compras", concept: "Otra" })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await read()).rows.find(i => i.id === replacement.id)).toMatchObject({ department: "Operaciones", concept: "Picking", quantity: "0.750000", version: 2 });
    await expect(resolveProductIncident(f.db.pool, randomUUID(), replacement.id, { expectedVersion: 1, note: "ok" })).rejects.toMatchObject({ status: 401 });
    await expect(resolveProductIncident(f.db.pool, f.actor, replacement.id, { expectedVersion: 1 })).rejects.toMatchObject({ code: "RESOLUTION_NOTE_REQUIRED" });
    await resolveProductIncident(f.db.pool, f.actor, replacement.id, { expectedVersion: 2, note: "Reposición atendida" });
    await expect(resolveProductIncident(f.db.pool, f.actor, replacement.id, { expectedVersion: 1, note: "Otra" })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await read(new URLSearchParams(), "live")).rows).toHaveLength(0);
    expect((await read()).rows).toHaveLength(4);
    await expect(f.db.pool.query("DELETE FROM route_product_incidents WHERE id=$1", [replacement.id])).rejects.toMatchObject({ code: "42501" });
    await expect(f.db.pool.query("UPDATE route_product_incidents SET quantity=1 WHERE id=$1", [replacement.id])).rejects.toMatchObject({ code: "42501" });
    await migrate(f.db.pool, f.db.config.instanceId);
    await migrate(f.db.pool, f.db.config.instanceId);
    expect(await counts()).toEqual(before);
  } finally { await f.close(); }
}, 120_000);

it("upgrades v26, protects concurrent quantities and closed visits, and exports beyond the first page", async () => {
  const f = await executionFixture();
  try {
    // Real upgrade fixture; remove only this feature from the isolated test database.
    await f.db.pool.query(`DROP TABLE route_product_incidents;
      ALTER TABLE route_plans DROP COLUMN archived_at;
      UPDATE rutas_installation SET schema_version=26`);
    await Promise.all([migrate(f.db.pool, f.db.config.instanceId), migrate(f.db.pool, f.db.config.instanceId)]);
    expect((await f.db.pool.query("SELECT schema_version FROM rutas_installation")).rows[0].schema_version).toBe(27);
    await f.start();
    const state = () => readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
    const identity = async () => {
      const r = await state(), s = r.stops[0];
      return { commandId: randomUUID(), executionId: r.id, publicationRevision: r.publicationRevision,
        executionRevision: r.revision, stopVersion: s.version, visitSequence: s.visitSequence,
        orderVersion: s.orderStates[0].version, policyVersion: r.policy.version };
    };
    const stop = (await state()).stops[0], shipment = stop.shipmentIds[0];
    const arrive = async () => executeStopCommand(f.db.pool, f.members[0].authorization, f.planId, stop.id, "arrival", {
      ...await identity(), sample: { latitude: 20.64, longitude: -103.4, accuracyMeters: 5,
        ageMilliseconds: 0, capturedAt: f.now.toISOString(), mock: false },
    }, f.timezone, f.now);
    const photo = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#abcdef" } }).jpeg().toBuffer();
    const run = (raw: Record<string, unknown>) => raw.lineIndex !== undefined
      ? reportProductIncidentWithEvidence(f.db.pool, f.members[0].authorization, f.planId, stop.id, shipment, raw, f.timezone, photo, "image/jpeg", f.photoRoot, f.now)
      : reportProductIncident(f.db.pool, f.members[0].authorization, f.planId, stop.id, shipment, raw, f.timezone, f.now);
    await arrive();
    await reportCustomerClosed(f.db.pool, f.members[0].authorization, f.planId, stop.id,
      await identity(), photo, "image/jpeg", f.timezone, f.photoRoot, f.now);
    const linked = { kind: "return", lineIndex: 0, quantity: "1.25", department: "Operaciones" };
    await expect(run({ ...await identity(), ...linked })).rejects.toMatchObject({ code: "RETRY_REQUIRES_NEW_ARRIVAL" });
    await exitDriverVisit(f.db.pool, f.members[0].authorization, f.planId, stop.id, await identity(), f.timezone, f.now);
    await arrive();
    const command = { ...await identity(), ...linked };
    const raced = await Promise.allSettled([run(command), run({ ...command, commandId: randomUUID() })]);
    expect(raced.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(raced.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "VERSION_CONFLICT" } });
    await expect(run({ ...await identity(), ...linked })).rejects.toMatchObject({ code: "INCIDENT_QUANTITY_EXCEEDED" });
    const incident = (await f.db.pool.query("SELECT * FROM route_product_incidents")).rows[0];
    // Bypassing application code still cannot exceed a publication line in PostgreSQL.
    await expect(f.db.pool.query(`INSERT INTO route_product_incidents
      SELECT (jsonb_populate_record(NULL::route_product_incidents,to_jsonb(p)||jsonb_build_object('id',$2::uuid))).*
      FROM route_product_incidents p WHERE id=$1`, [incident.id, randomUUID()]))
      .rejects.toMatchObject({ code: "23514", message: "INCIDENT_QUANTITY_EXCEEDED" });
    for (let i = 0; i < 51; i++) await run({ ...await identity(), kind: "shortage_validation", department: "Operaciones",
      product: `Faltante ${i}`, unit: "kg", quantity: "0.5" });
    const params = new URLSearchParams({ from: "2026-09-24", to: "2026-09-24" });
    const first = await readProductIncidents(f.db.pool, f.actor, params, f.timezone);
    expect(first.rows).toHaveLength(50); expect(first.nextCursor).toBeTruthy();
    const second = await readProductIncidents(f.db.pool, f.actor,
      new URLSearchParams({ ...Object.fromEntries(params), cursor: first.nextCursor! }), f.timezone);
    expect(second.rows).toHaveLength(2); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(52);
    expect((await readProductIncidents(f.db.pool, f.actor, params, f.timezone, "export")).rows).toHaveLength(52);
    await expect(readProductIncidents(f.db.pool, randomUUID(), params, f.timezone)).rejects.toMatchObject({ status: 401 });
  } finally { await f.close(); }
}, 120_000);
