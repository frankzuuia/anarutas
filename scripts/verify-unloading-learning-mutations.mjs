import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), scratch = join(root, ".local");
await mkdir(scratch, { recursive: true });
const sandbox = await mkdtemp(join(scratch, "unloading-mutants-"));
const policy = "src/core/unloading-learning.ts", schema = "src/core/unloading-learning-schema.ts";
const test = "tests/unloading-learning.test.ts";
const cases = [
  ["second-visit", schema, "CASE WHEN recent.sample_count>=2 THEN", "CASE WHEN recent.sample_count>=3 THEN"],
  ["manual-mode", schema, "c.unloading_automatic AND recent.sample_count>=2", "recent.sample_count>=2"],
  ["rolling-three", schema, "arrival_event_id DESC LIMIT 3", "arrival_event_id DESC LIMIT 100"],
  ["newest-visits", schema, "ORDER BY completed_at DESC,arrival_event_id DESC LIMIT", "ORDER BY completed_at ASC,arrival_event_id DESC LIMIT"],
  ["median", schema, "percentile_cont(0.5)", "percentile_cont(0)"],
  ["rounding", schema, "ceil(percentile_cont", "floor(percentile_cont"],
  ["location-isolation", schema, "customer_id=c.id AND location_version=c.location_version", "customer_id=c.id"],
  ["all-orders", policy, "count(obs.payment_id)=count(*)", "count(obs.payment_id)>0"],
  ["same-visit", policy, " AND obs.arrival_event_id=$1", ""],
  ["future-capture", policy, "Date.parse(capturedAt) <= receivedAt.getTime()", "true"],
  ["positive-duration", policy, "elapsed > 0", "elapsed >= 0"],
  ["maximum-duration", policy, "elapsed <= maximumUnloadingMinutes * 60_000", "true"],
  ["reject-invalid-time", policy, "!usableCollectionTime(capturedAt, arrival.occurred_at, receivedAt)", "false"],
  ["payment-evidence", "src/core/payments.ts", "attention.capturedAt ?? null, now", "null, now"],
  ["frozen-live-time", "src/core/live-routes.ts", 'return published && "unloadingMinutes" in published ? published.unloadingMinutes ?? null : manual ?? null;', "return manual ?? null;"],
];
try {
  for (const path of ["src/core", "tests/helpers", test, "package.json"])
    await cp(join(root, path), join(sandbox, path), { recursive: true });
  await symlink(join(root, "node_modules"), join(sandbox, "node_modules"), "junction");
  await writeFile(join(sandbox, "vitest.config.mjs"), "export default {test:{fileParallelism:false,testTimeout:60000,hookTimeout:120000}};\n");
  const originals = new Map(await Promise.all([...new Set(cases.map(c => c[1]))].map(async path => [path, await readFile(join(root, path), "utf8")])));
  const run = async name => {
    const report = join(sandbox, `${name}.json`);
    const code = await new Promise((done, fail) => {
      const child = spawn(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", test, "--reporter=json", `--outputFile=${report}`],
        { cwd: sandbox, windowsHide: true, stdio: "ignore" });
      child.on("error", fail); child.on("exit", done);
    });
    const summary = JSON.parse(await readFile(report, "utf8"));
    return { name, code, passed: summary.numPassedTests, failed: summary.numFailedTests };
  };
  const baseline = await run("baseline");
  if (baseline.code !== 0 || baseline.passed !== 10) throw new Error(`BASELINE_FAILED: ${JSON.stringify(baseline)}`);
  console.log(JSON.stringify(baseline));
  const results = [];
  for (const [name, path, from, to] of cases) {
    const original = originals.get(path);
    if (original.split(from).length !== 2) throw new Error(`NON_UNIQUE_MUTATION: ${name}`);
    await writeFile(join(sandbox, path), original.replace(from, to));
    const result = await run(name);
    await writeFile(join(sandbox, path), original);
    results.push({ ...result, killed: result.code !== 0 && result.failed > 0 });
    console.log(JSON.stringify(results.at(-1)));
  }
  await mkdir(join(root, "reports/mutation"), { recursive: true });
  await writeFile(join(root, "reports/mutation/unloading-learning.json"), JSON.stringify({ baseline, results }, null, 2));
  if (results.some(r => !r.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (!within.startsWith("unloading-mutants-") || within.includes("..") || resolve(sandbox) === resolve(scratch)) throw new Error("UNSAFE_CLEANUP_PATH");
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
