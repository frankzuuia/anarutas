import { randomUUID } from "node:crypto";
import { readdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import { readProductIncidents, reportProductIncident } from "../src/core/product-incidents";
import { reportProductIncidentWithEvidence, readProductIncidentEvidence } from "../src/core/product-incidents-evidence";
import { cleanIncidentEvidence } from "../src/core/driver-incident-evidence";
import { archiveWeeklyPlans } from "../src/core/plan-archive";

it("requires private image evidence, binds it to the receipt, cleans failed uploads and preserves historical photos", async () => {
  const f = await executionFixture();
  try {
    await f.start();
    const state = () => readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
    const initial = await state(), stop = initial.stops[0], shipment = stop.shipmentIds[0];
    const identity = async () => {
      const r = await state(), s = r.stops[0];
      return { commandId: randomUUID(), executionId: r.id, publicationRevision: r.publicationRevision,
        executionRevision: r.revision, stopVersion: s.version, visitSequence: s.visitSequence,
        orderVersion: s.orderStates[0].version, policyVersion: r.policy.version };
    };
    await executeStopCommand(f.db.pool, f.members[0].authorization, f.planId, stop.id, "arrival", {
      ...await identity(), sample: { latitude: 20.64, longitude: -103.4, accuracyMeters: 5,
        ageMilliseconds: 0, capturedAt: f.now.toISOString(), mock: false },
    }, f.timezone, f.now);
    const input = { ...await identity(), kind: "replacement_quality", department: "Operaciones", lineIndex: 0, quantity: "0.5" };
    for (const kind of ["replacement_quality", "replacement_wrong_product", "return"])
      await expect(reportProductIncident(f.db.pool, f.members[0].authorization, f.planId, stop.id, shipment,
        { ...input, kind }, f.timezone, f.now)).rejects.toMatchObject({ code: "PRODUCT_EVIDENCE_REQUIRED" });
    const photo = (background: string) => sharp({ create: { width: 64, height: 64, channels: 3, background } }).jpeg().toBuffer();
    const bytes = await photo("#339977");
    const run = (payload = input, data = bytes, authorization = f.members[0].authorization) =>
      reportProductIncidentWithEvidence(f.db.pool, authorization, f.planId, stop.id, shipment,
        payload, f.timezone, data, "image/jpeg", f.photoRoot, f.now);
    await expect(run(input, bytes, "Bearer invalid")).rejects.toMatchObject({ status: 401 });
    await expect(run(input, Buffer.from("not an image"))).rejects.toMatchObject({ code: "UNIT_PHOTO_INVALID" });
    const result = await run();
    expect((await run()).duplicate).toBe(true);
    await expect(run(input, await photo("#dd0022"))).rejects.toMatchObject({ code: "COMMAND_REUSED" });
    await expect(run({ ...input, commandId: randomUUID() })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const root = join(f.photoRoot, "incident-evidence");
    const files = await readdir(root);
    expect(files).toHaveLength(1);
    const incident = (await readProductIncidents(f.db.pool, f.actor,
      new URLSearchParams({ from: "2026-09-24", to: "2026-09-24" }), f.timezone)).rows[0];
    expect(incident.evidenceId).toBeTruthy();
    expect(files[0]).toBe(`${incident.evidenceId}.webp`);
    const read = () => readProductIncidentEvidence(f.db.pool, f.actor, result.incidentId!, f.photoRoot);
    const metadata = await sharp(await read()).metadata();
    expect(metadata.format).toBe("webp"); expect(metadata.exif).toBeUndefined();
    await expect(readProductIncidentEvidence(f.db.pool, randomUUID(), result.incidentId!, f.photoRoot)).rejects.toMatchObject({ status: 401 });
    await expect(readProductIncidentEvidence(f.db.pool, f.actor, randomUUID(), f.photoRoot)).rejects.toMatchObject({ status: 404 });
    await expect(readProductIncidentEvidence(f.db.pool, f.actor, "../../private", f.photoRoot)).rejects.toThrow();
    await expect(f.db.pool.query("UPDATE route_product_incidents SET evidence_id=$2 WHERE id=$1", [result.incidentId, randomUUID()]))
      .rejects.toMatchObject({ code: "42501" });
    const old = new Date(Date.now() - 72 * 3600_000);
    await utimes(join(root, files[0]), old, old);
    await cleanIncidentEvidence(f.db.pool, f.photoRoot);
    await archiveWeeklyPlans(f.db.pool, f.timezone, new Date("2026-09-28T02:00:00Z"));
    expect(await readdir(root)).toEqual(files);
    expect((await read()).length).toBeGreaterThan(0);
    const without = await reportProductIncident(f.db.pool, f.members[0].authorization, f.planId, stop.id, shipment,
      { ...await identity(), kind: "shortage_validation", department: "Compras", product: "Ausente", unit: "kg", quantity: "1" }, f.timezone, f.now);
    await expect(readProductIncidentEvidence(f.db.pool, f.actor, without.incidentId!, f.photoRoot)).rejects.toMatchObject({ status: 404 });
  } finally { await f.close(); }
}, 120_000);
