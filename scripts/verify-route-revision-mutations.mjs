import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// SQL is opaque to Stryker. Mutate exact SQL fragments in a disposable checkout;
// never edit the active tree and only run the real isolated-Postgres tests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = join(root, ".local");
await mkdir(scratchRoot, { recursive: true });
const sandbox = await mkdtemp(join(scratchRoot, "revision-mutants-"));
const helper = "src/core/route-publication-revisions.ts";
const schema = "src/core/route-publication-revisions-schema.ts";
const cases = [
  ["no-increment", helper, "+1 AS revision", "+0 AS revision", "readding a cancelled"],
  ["ignore-plan", helper, "WHERE plan_id=$1 AND vehicle_id=$2", "WHERE $1::uuid IS NOT NULL AND vehicle_id=$2", "retains unstarted"],
  ["ignore-vehicle", helper, "WHERE plan_id=$1 AND vehicle_id=$2", "WHERE plan_id=$1 AND $2::uuid IS NOT NULL", "retains unstarted"],
  ["ignore-previous-floor", helper, "),0),$3::integer)", "),0),0*$3::integer)", "retains unstarted"],
  ["omit-publication-seed", schema, "SELECT plan_id,vehicle_id,revision FROM route_plan_publications", "SELECT plan_id,vehicle_id,0 AS revision FROM route_plan_publications", "retains unstarted"],
  ["omit-execution-seed", schema, "SELECT plan_id,vehicle_id,publication_revision FROM route_driver_executions", "SELECT plan_id,vehicle_id,0 FROM route_driver_executions", "upgrades schema"],
  ["omit-publication-audit", schema, "WHERE a.action='route.publication.changed'", "WHERE a.action='mutation.disabled'", "upgrades schema"],
  ["omit-cancellation-audit", schema, "WHERE action IN ('route.start.cancelled','route.publication.cancelled')", "WHERE action IN ('mutation.disabled')", "upgrades schema"],
  ["reset-on-delete", schema, "target_revision:=OLD.revision", "target_revision:=1", "retains unstarted"],
  ["decrease-retained-floor", schema, "WHERE route_publication_revisions.last_revision<EXCLUDED.last_revision", "WHERE true", "retains unstarted"],
  ["decrease-migration-floor", schema, "last_revision=GREATEST(route_publication_revisions.last_revision,EXCLUDED.last_revision)", "last_revision=EXCLUDED.last_revision", "upgrades schema"],
];
const results = [];
try {
  for (const path of ["src/core", "tests/helpers", "tests/route-publication-revisions.test.ts", "package.json"])
    await cp(join(root, path), join(sandbox, path), { recursive: true });
  await symlink(join(root, "node_modules"), join(sandbox, "node_modules"), "junction");
  await writeFile(join(sandbox, "vitest.config.mjs"), 'export default {test:{include:["tests/route-publication-revisions.test.ts"],fileParallelism:false}};\n');
  const originals = new Map(await Promise.all([helper, schema].map(async path => [path, await readFile(join(root, path), "utf8")])));
  const run = async (name, pattern) => {
    const report = join(sandbox, `${name}.json`);
    const args = [join(root, "node_modules/vitest/vitest.mjs"), "run", "--reporter=json", `--outputFile=${report}`];
    if (pattern) args.push("--testNamePattern", pattern);
    const code = await new Promise((done, fail) => {
      const child = spawn(process.execPath, args, { cwd: sandbox, windowsHide: true, stdio: "ignore" });
      child.on("error", fail); child.on("exit", done);
    });
    const summary = JSON.parse(await readFile(report, "utf8"));
    return { name, code, passed: summary.numPassedTests, failed: summary.numFailedTests };
  };
  const baseline = await run("baseline");
  if (baseline.code !== 0 || baseline.passed !== 3) throw new Error(`BASELINE_FAILED: ${JSON.stringify(baseline)}`);
  console.log(JSON.stringify(baseline));
  for (const [name, path, from, to, pattern] of cases) {
    const original = originals.get(path);
    if (original.split(from).length !== 2) throw new Error(`NON_UNIQUE_MUTATION: ${name}`);
    await writeFile(join(sandbox, path), original.replace(from, to));
    const result = await run(name, pattern);
    await writeFile(join(sandbox, path), original);
    const killed = result.code !== 0 && result.failed > 0;
    results.push({ ...result, killed });
    console.log(JSON.stringify(results.at(-1)));
  }
  await mkdir(join(root, "reports/mutation"), { recursive: true });
  await writeFile(join(root, "reports/mutation/route-revision-sql.json"), JSON.stringify({ baseline, results }, null, 2));
  if (results.some(result => !result.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratchRoot, sandbox);
  if (!within.startsWith("revision-mutants-") || within.includes("..")) throw new Error("UNSAFE_CLEANUP_PATH");
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
