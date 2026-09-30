import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Mechanical changes only in a disposable checkout. Every run uses actual isolated PostgreSQL.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = join(root, ".local");
await mkdir(scratchRoot, { recursive: true });
const sandbox = await mkdtemp(join(scratchRoot, "warehouse-mutants-"));
const writer = "src/core/live-tracking.ts", reader = "src/core/live-routes.ts", policy = "src/core/live-warehouse-policy.ts";
const cases = [
  ["require-current-origin", writer, "settings.version !== destination.depotVersion", "false"],
  ["require-terminal-orders", writer, "assertCompletionOrders(publication.orders.map((order: { id: string }) => order.id), orders);", "void orders;"],
  ["sequence-fence", writer, "sequence <= Number(current.sequence)", "false"],
  ["clear-on-new-session", writer, "eta=NULL,warehouse_depot_version=NULL", "eta=NULL,warehouse_depot_version=route_live_tracking.warehouse_depot_version"],
  ["persist-warehouse", writer, "destination?.depotVersion ?? null]);", "null]);"],
  ["reader-current-origin", policy, "settings.version !== stored.version", "false"],
  ["reader-revoked-device", reader, "dev.revoked_at IS NOT NULL OR", ""],
  ["reader-hide-retired-eta", reader, "e.eta?.depotVersion != null && !warehouse ? null : e.eta ?? null", "e.eta ?? null"],
];
const results = [];
try {
  for (const path of ["src/core", "tests/helpers", "tests/live-warehouse-integration.test.ts", "package.json"])
    await cp(join(root, path), join(sandbox, path), { recursive: true });
  await symlink(join(root, "node_modules"), join(sandbox, "node_modules"), "junction");
  await writeFile(join(sandbox, "vitest.config.mjs"), 'export default {test:{include:["tests/live-warehouse-integration.test.ts"],fileParallelism:false}};\n');
  const originals = new Map(await Promise.all([...new Set(cases.map(c => c[1]))].map(async path => [path, await readFile(join(root, path), "utf8")])));
  const run = async name => {
    const report = join(sandbox, `${name}.json`);
    const code = await new Promise((done, fail) => {
      const child = spawn(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", "--reporter=json", `--outputFile=${report}`],
        { cwd: sandbox, windowsHide: true, stdio: "ignore" });
      child.on("error", fail); child.on("exit", done);
    });
    const summary = JSON.parse(await readFile(report, "utf8"));
    return { name, code, passed: summary.numPassedTests, failed: summary.numFailedTests };
  };
  const baseline = await run("baseline");
  if (baseline.code !== 0 || baseline.passed !== 1) throw new Error(`BASELINE_FAILED: ${JSON.stringify(baseline)}`);
  console.log(JSON.stringify(baseline));
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
  await writeFile(join(root, "reports/mutation/live-warehouse-integration.json"), JSON.stringify({ baseline, results }, null, 2));
  if (results.some(result => !result.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratchRoot, sandbox);
  if (!within.startsWith("warehouse-mutants-") || within.includes("..") || resolve(sandbox) === resolve(scratchRoot)) throw new Error("UNSAFE_CLEANUP_PATH");
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
