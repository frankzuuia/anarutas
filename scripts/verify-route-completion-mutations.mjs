import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Controlled mechanical mutations in a disposable directory. Real isolated PostgreSQL, no API doubles.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = join(root, ".local");
await mkdir(scratchRoot, { recursive: true });
const sandbox = await mkdtemp(join(scratchRoot, "completion-mutants-"));
const finish = "src/core/driver-route-completion.ts", read = "src/core/driver-execution-read.ts";
const context = "src/core/driver-service-context.ts", order = "src/core/driver-order-command.ts";
const first = "finishes atomically", remote = "reprograms a real";
const cases = [
  ["require-pending-free", finish, "assertCompletionOrders(publication.orders.map((order: { id: string }) => order.id), orders);", "void orders;", first],
  ["require-real-proximity", finish, "distance = validateProximity(input.sample, settings.depotLocation, policy, now)", "distance = 0", first],
  ["require-execution-version", finish, "route.revision !== input.executionRevision", "false", first],
  ["require-depot-version", finish, "settings.version !== input.depotVersion", "false", first],
  ["require-policy-version", finish, "policy.version !== input.policyVersion", "false", first],
  ["freeze-completed-route", read, "if (route.completed_at)", "if (false)", first],
  ["stop-tracking", finish, "SET stopped=true,target_stop_id", "SET stopped=stopped,target_stop_id", first],
  ["increment-execution", finish, "SET revision=revision+1", "SET revision=revision+0", first],
  ["allow-remote-reschedule-only", context, "(requireActiveVisit && stop.visit_state", "(true && stop.visit_state", remote],
  ["require-real-closed-case", order, "if (!closedCase.rowCount)", "if (false)", remote],
];
const results = [];
try {
  for (const path of ["src/core", "tests/helpers", "tests/driver-route-completion.test.ts", "package.json"])
    await cp(join(root, path), join(sandbox, path), { recursive: true });
  await symlink(join(root, "node_modules"), join(sandbox, "node_modules"), "junction");
  await writeFile(join(sandbox, "vitest.config.mjs"), 'export default {test:{include:["tests/driver-route-completion.test.ts"],fileParallelism:false}};\n');
  const originals = new Map(await Promise.all([...new Set(cases.map(c => c[1]))].map(async path => [path, await readFile(join(root, path), "utf8")])));
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
  if (baseline.code !== 0 || baseline.passed !== 4) throw new Error(`BASELINE_FAILED: ${JSON.stringify(baseline)}`);
  console.log(JSON.stringify(baseline));
  for (const [name, path, from, to, pattern] of cases) {
    const original = originals.get(path);
    if (original.split(from).length !== 2) throw new Error(`NON_UNIQUE_MUTATION: ${name}`);
    await writeFile(join(sandbox, path), original.replace(from, to));
    const result = await run(name, pattern);
    await writeFile(join(sandbox, path), original);
    results.push({ ...result, killed: result.code !== 0 && result.failed > 0 });
    console.log(JSON.stringify(results.at(-1)));
  }
  await mkdir(join(root, "reports/mutation"), { recursive: true });
  await writeFile(join(root, "reports/mutation/route-completion-integration.json"), JSON.stringify({ baseline, results }, null, 2));
  if (results.some(result => !result.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratchRoot, sandbox);
  if (!within.startsWith("completion-mutants-") || within.includes("..") || resolve(sandbox) === resolve(scratchRoot)) throw new Error("UNSAFE_CLEANUP_PATH");
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
