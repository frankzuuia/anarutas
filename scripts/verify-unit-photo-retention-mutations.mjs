import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = join(root, ".local");
await mkdir(scratch, { recursive: true });
const sandbox = await mkdtemp(join(scratch, "unit-photo-mutants-"));
const policy = "src/core/unit-photo-retention.ts";
const schema = "src/core/unit-photo-retention-schema.ts";
const photos = "src/core/unit-photos.ts";
const schedule = "src/server/unit-photo-cleanup.ts";
const test = "tests/unit-photo-retention.test.ts";
const cases = [
  ["retain-thirty-days", policy, "unitPhotoRetentionDays = 30", "unitPhotoRetentionDays = 15"],
  ["sweep-daily", policy, "24 * 60 * 60 * 1000", "60 * 60 * 1000"],
  ["database-default", schema, "SET DEFAULT (now()+interval '30 days')", "SET DEFAULT (now()+interval '15 days')"],
  ["extend-existing", schema, "SET expires_at=created_at+interval '30 days'", "SET expires_at=created_at+interval '15 days'"],
  ["preserve-explicit-expiry", schema, "WHERE expires_at=created_at+interval '15 days'", "WHERE true"],
  ["only-expired", photos, "SELECT id FROM route_unit_photos WHERE expires_at<=now()", "SELECT id FROM route_unit_photos WHERE expires_at>now()"],
  ["drain-backlog", photos, "if (rows.length < 200) break;", "break;"],
  ["protect-referenced-file", photos, "if (!reference.rowCount)", "if (true)"],
  ["boundary-due", schedule, "now < this.nextCleanup", "now <= this.nextCleanup"],
  ["exclude-overlap", schedule, "this.running || ", ""],
  ["remember-success", schedule, "this.nextCleanup = now + unitPhotoCleanupIntervalMs", "this.nextCleanup = now"],
  ["retry-failure", schedule, "} finally {", "} finally { this.nextCleanup = now + unitPhotoCleanupIntervalMs;"],
];
const results = [];
try {
  for (const path of ["src/core", schedule, "tests/helpers", test, "package.json"])
    await cp(join(root, path), join(sandbox, path), { recursive: true });
  await symlink(join(root, "node_modules"), join(sandbox, "node_modules"), "junction");
  await writeFile(join(sandbox, "vitest.config.mjs"), "export default {test:{fileParallelism:false,testTimeout:30000,hookTimeout:60000}};\n");
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
  if (baseline.code !== 0 || baseline.passed !== 11) throw new Error(`BASELINE_FAILED: ${JSON.stringify(baseline)}`);
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
  await writeFile(join(root, "reports/mutation/unit-photo-retention.json"), JSON.stringify({ baseline, results }, null, 2));
  if (results.some(r => !r.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (!within.startsWith("unit-photo-mutants-") || within.includes("..") || resolve(sandbox) === resolve(scratch)) throw new Error("UNSAFE_CLEANUP_PATH");
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
