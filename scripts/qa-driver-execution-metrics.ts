import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { executionFixture } from "../tests/helpers/driver-execution";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import { readDriverIncidents } from "../src/core/driver-incidents";

// Isolated real PostgreSQL only. Never reads an installation URL or contacts Google/Odoo.
const fixture = await executionFixture();
const commands: number[] = [], queries: number[] = [];
const member = fixture.members[0];
const filters = new URLSearchParams({ from: "2026-09-24", to: "2026-09-24", driverId: member.driverId });
try {
  await fixture.start();
  for (let index = 0; index < 30; index++) {
    const execution = await readDriverExecution(fixture.db.pool, member.driverId, fixture.planId, fixture.timezone);
    const stop = execution.stops[0];
    const point = { latitude: 20.6401 + (index % 2) * .0001, longitude: -103.4 };
    const start = performance.now();
    await executeStopCommand(fixture.db.pool, member.authorization, fixture.planId, stop.id, "repoint", {
      commandId: randomUUID(), executionId: execution.id, publicationRevision: execution.publicationRevision,
      executionRevision: execution.revision, stopVersion: stop.version, policyVersion: execution.policy.version,
      point, customerLocationVersion: stop.customerLocationVersion,
      sample: { ...point, accuracyMeters: 5, ageMilliseconds: 0, capturedAt: fixture.now.toISOString(), mock: false },
    }, fixture.timezone, fixture.now);
    commands.push(performance.now() - start);
    const readStart = performance.now();
    await readDriverIncidents(fixture.db.pool, filters, fixture.timezone);
    queries.push(performance.now() - readStart);
  }
  const summarize = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { n: values.length, p50Ms: sorted[Math.ceil(values.length * .5) - 1], p95Ms: sorted[Math.ceil(values.length * .95) - 1], maxMs: sorted.at(-1) };
  };
  const report = { recordedAt: new Date().toISOString(), scope: "local isolated PostgreSQL, not mobile/network SLO",
    repoint: summarize(commands), incidentQuery: summarize(queries), errors: 0,
    events: Number((await fixture.db.pool.query("SELECT count(*) n FROM route_driver_stop_events")).rows[0].n) };
  await mkdir("reports/driver-execution", { recursive: true });
  await writeFile("reports/driver-execution/latency.json", JSON.stringify(report, null, 2));
  console.info(JSON.stringify(report));
} finally { await fixture.close(); }
