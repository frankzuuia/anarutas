import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { executionFixture } from "../tests/helpers/driver-execution";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import { executeDriverOrderCommand } from "../src/core/driver-order-command";
import { completeDriverRoute } from "../src/core/driver-route-completion";
import { saveRoutingSettings } from "../src/core/routing-settings";

// Only a dedicated ephemeral database. Never reads a production DB URL or invokes an external service.
const f = await executionFixture();
try {
  await f.start();
  const depot = await saveRoutingSettings(f.db.pool, f.actor, { expectedVersion: 0, depotAddress: "Bodega métricas QA",
    depotLocation: { latitude: 20.64, longitude: -103.4 } });
  const read = () => readDriverExecution(f.db.pool, f.members[0].driverId, f.planId, f.timezone);
  const sample = { latitude: 20.64, longitude: -103.4, accuracyMeters: 5, ageMilliseconds: 0, capturedAt: f.now.toISOString(), mock: false };
  for (let index = 0; index < 3; index++) {
    let execution = await read(), stop = execution.stops[index];
    await executeStopCommand(f.db.pool, f.members[0].authorization, f.planId, stop.id, "arrival", {
      commandId: randomUUID(), executionId: execution.id, publicationRevision: execution.publicationRevision,
      executionRevision: execution.revision, stopVersion: stop.version, policyVersion: execution.policy.version, sample,
    }, f.timezone, f.now);
    execution = await read(); stop = execution.stops[index];
    await executeDriverOrderCommand(f.db.pool, f.members[0].authorization, f.planId, stop.id, stop.orderStates[0].shipmentId, {
      commandId: randomUUID(), executionId: execution.id, publicationRevision: execution.publicationRevision,
      executionRevision: execution.revision, stopVersion: stop.version, visitSequence: stop.visitSequence,
      orderVersion: stop.orderStates[0].version, kind: "deliver",
    }, f.timezone, f.now);
  }
  const execution = await read();
  const input = { commandId: randomUUID(), executionId: execution.id, publicationRevision: execution.publicationRevision,
    executionRevision: execution.revision, depotVersion: depot.version, policyVersion: execution.policy.version, sample, confirmed: true };
  const durations: number[] = [];
  for (let index = 0; index < 31; index++) {
    const start = performance.now();
    const result = await completeDriverRoute(f.db.pool, f.members[0].authorization, f.planId, input, f.now);
    if (result.duplicate !== (index > 0)) throw new Error("INCORRECT_COMPLETION_RECEIPT");
    durations.push(performance.now() - start);
  }
  const repeats = durations.slice(1).sort((a, b) => a - b);
  const report = { at: new Date().toISOString(), scope: "local isolated PostgreSQL; not an Android/network/production SLO",
    firstCompletionMs: durations[0], replay: { n: repeats.length, p50Ms: repeats[14], p95Ms: repeats[28], maxMs: repeats.at(-1) },
    errors: 0, duplicateClosures: 0, durableClosures: (await f.db.pool.query("SELECT count(*)::int AS n FROM route_driver_execution_completions")).rows[0].n };
  await mkdir("reports/route-completion", { recursive: true });
  await writeFile("reports/route-completion/latency.json", JSON.stringify(report, null, 2));
  console.info(JSON.stringify(report));
} finally { await f.close(); }
