import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// PostgreSQL-backed mutation checks in a disposable copy, never in the working tree.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = join(root, ".local");
await mkdir(scratchRoot, { recursive: true });
const sandbox = await mkdtemp(join(scratchRoot, "financial-mutants-"));
const store = "src/core/financial-store.ts", schema = "src/core/financial-schema.ts", sync = "src/core/financial-sync.ts";
const cases = [
  ["admin-authorization", store, "await assertActiveActor(client, actor);", "void actor;"],
  ["shipment-isolation", store, "WHERE s.id=$1", "WHERE s.id=$1 OR true"],
  ["source-isolation", store, "WHERE t.source=$1 AND t.next_attempt_at<=now()", "WHERE (t.source=$1 OR true) AND t.next_attempt_at<=now()"],
  ["worker-exclusion", store, "return result.rows[0].acquired === true;", "return true;"],
  ["partner-identity", store, "Number(rows[0].partner_id) !== target.partnerId", "false"],
  ["revision-idempotence", store, "const changed = rows[0].content_hash !== hash;", "const changed = true;"],
  ["immutable-history", schema, "RAISE EXCEPTION 'FINANCIAL_REVISION_IMMUTABLE' USING ERRCODE='42501';", "RETURN OLD;"],
  ["import-identity", schema, "AND order_id=NEW.order_id AND partner_id=NEW.partner_id", "AND order_id=NEW.order_id"],
  ["source-cooldown", sync, "if (!state.rows[0].due)", "if (false)"],
  ["read-only-error-preserves-head", sync, "SET failures=failures+1,last_error=$4,last_checked_at=now(),", "SET revision=0,content_hash=NULL,failures=failures+1,last_error=$4,last_checked_at=now(),"],
  ["failed-target-isolation", store, "result.rows[0]?.failures > 0", "false"],
  ["healthy-batch-isolation", store, "result.rows.filter((row) => row.failures === 0)", "result.rows"],
];
const results = [];
try {
  for (const path of ["src/core", "tests/helpers", "tests/financial-store.test.ts", "package.json"])
    await cp(join(root, path), join(sandbox, path), { recursive: true });
  await symlink(join(root, "node_modules"), join(sandbox, "node_modules"), "junction");
  await writeFile(join(sandbox, "vitest.config.mjs"), 'export default {test:{include:["tests/financial-store.test.ts"],fileParallelism:false,testTimeout:30000,hookTimeout:120000}};\n');
  const originals = new Map(await Promise.all([...new Set(cases.map(item => item[1]))].map(async path => [path, await readFile(join(root, path), "utf8")])));
  async function run(name) {
    const report = join(sandbox, `${name}.json`);
    const code = await new Promise((done, fail) => {
      const child = spawn(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", "--reporter=json", `--outputFile=${report}`],
        { cwd: sandbox, windowsHide: true, stdio: "ignore" });
      child.on("error", fail); child.on("exit", done);
    });
    const summary = JSON.parse(await readFile(report, "utf8"));
    return { name, code, passed: summary.numPassedTests, failed: summary.numFailedTests };
  }
  const baseline = await run("baseline");
  if (baseline.code !== 0 || baseline.passed !== 10) throw new Error(`BASELINE_FAILED: ${JSON.stringify(baseline)}`);
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
  await writeFile(join(root, "reports/mutation/financial-integration.json"), JSON.stringify({ baseline, results }, null, 2));
  if (results.some(result => !result.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratchRoot, sandbox);
  if (!within.startsWith("financial-mutants-") || within.includes("..") || resolve(sandbox) === resolve(scratchRoot)) throw new Error("UNSAFE_CLEANUP_PATH");
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
