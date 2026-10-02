import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = join(root, ".local");
await mkdir(scratch, { recursive: true });
const sandbox = await mkdtemp(join(scratch, "settlement-filter-mutants-"));
const cases = [
  [
    "ignore-driver-scope",
    "($3::uuid IS NULL OR e.driver_id=$3)",
    "($3::uuid IS NULL OR $3::uuid IS NOT NULL)",
  ],
  [
    "hide-inactive-drivers",
    "SELECT id,name,active FROM route_drivers ORDER BY name,id",
    "SELECT id,name,active FROM route_drivers WHERE active ORDER BY name,id",
  ],
  [
    "expose-private-roster",
    "SELECT id,name,active FROM route_drivers ORDER BY name,id",
    "SELECT * FROM route_drivers ORDER BY name,id",
  ],
  ["omit-roster", "      drivers,", "      drivers: [],"],
  [
    "bypass-report-authorization",
    'await assertActiveActor(sql, actor, "settlement");',
    "",
  ],
];
const results = [];
try {
  for (const entry of [
    "src/core",
    "tests/helpers",
    "tests/settlement-driver-filter.test.ts",
    "package.json",
  ])
    await cp(join(root, entry), join(sandbox, entry), { recursive: true });
  await symlink(
    join(root, "node_modules"),
    join(sandbox, "node_modules"),
    "junction",
  );
  await writeFile(
    join(sandbox, "vitest.config.mjs"),
    "export default {test:{fileParallelism:false,maxWorkers:1,testTimeout:60000,hookTimeout:120000}};",
  );
  async function run(name) {
    const report = join(sandbox, `${name}.json`);
    const code = await new Promise((done, fail) => {
      const child = spawn(
        process.execPath,
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          "tests/settlement-driver-filter.test.ts",
          "--reporter=json",
          `--outputFile=${report}`,
        ],
        { cwd: sandbox, windowsHide: true, stdio: "ignore" },
      );
      child.on("error", fail);
      child.on("exit", done);
    });
    const summary = JSON.parse(await readFile(report, "utf8"));
    const failures = summary.testResults
      .flatMap((s) => s.assertionResults)
      .filter((a) => a.status === "failed");
    return {
      name,
      code,
      passed: summary.numPassedTests,
      failed: summary.numFailedTests,
      failures: failures.map((a) => ({
        name: a.fullName,
        messages: a.failureMessages,
      })),
    };
  }
  const baseline = await run("baseline");
  if (baseline.code !== 0 || baseline.passed !== 4)
    throw new Error("BASELINE_FAILED");
  const target = join(sandbox, "src/core/finance-read.ts");
  const original = await readFile(target, "utf8");
  const start = original.indexOf("export async function listSettlements(");
  if (start < 0) throw new Error("INVALID_SCOPE");
  const scope = original.slice(start);
  for (const [name, from, to] of cases) {
    if (scope.split(from).length !== 2)
      throw new Error(`NON_UNIQUE_MUTATION:${name}`);
    await writeFile(target, original.slice(0, start) + scope.replace(from, to));
    const result = await run(name);
    await writeFile(target, original);
    results.push({
      ...result,
      killed: result.code !== 0 && result.failures.length > 0,
    });
    console.log(JSON.stringify({ ...results.at(-1), failures: undefined }));
  }
  await mkdir(join(root, "reports/mutation"), { recursive: true });
  await writeFile(
    join(root, "reports/mutation/settlement-filter.json"),
    JSON.stringify({ baseline, results }, null, 2),
  );
  if (results.some((r) => !r.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (
    !within.startsWith("settlement-filter-mutants-") ||
    within.includes("..") ||
    resolve(sandbox) === resolve(scratch)
  )
    throw new Error("UNSAFE_CLEANUP_PATH");
  await rm(sandbox, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
