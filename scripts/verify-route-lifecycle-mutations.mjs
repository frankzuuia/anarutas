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

// Mutants run only in a disposable checkout against isolated real PostgreSQL.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = join(root, ".local");
await mkdir(scratch, { recursive: true });
const sandbox = await mkdtemp(join(scratch, "closure-mutants-"));
const cases = [
  [
    "ignore-work-timestamp",
    "route-lifecycle.ts",
    "COALESCE(w.completed_at,c.completed_at)",
    "c.completed_at",
  ],
  [
    "wrong-publication-revision",
    "route-lifecycle.ts",
    "e.publication_revision=pub.revision",
    "e.publication_revision=pub.revision+1",
  ],
  [
    "show-closed-today",
    "route-lifecycle.ts",
    "&& !plan.work_completed_at",
    "&& true",
  ],
  [
    "ignore-service-day",
    "route-lifecycle.ts",
    "plan.service_date === serviceDate",
    "true",
  ],
  [
    "prefer-finished-over-active",
    "route-lifecycle.ts",
    "plan.started_at !== null",
    "plan.started_at === null",
  ],
  [
    "keep-closed-live",
    "live-routes.ts",
    "WHERE NOT EXISTS(SELECT 1 FROM route_driver_work_completions w WHERE w.execution_id=e.id)",
    "",
  ],
  [
    "allow-closed-commands",
    "driver-execution-read.ts",
    "if (route.completed_at)",
    "if (false)",
  ],
  [
    "do-not-stop-gps",
    "route-work.ts",
    "SET stopped=true,target_stop_id=NULL",
    "SET stopped=false,target_stop_id=NULL",
  ],
  [
    "retain-active-target",
    "route-work.ts",
    "target_stop_id=NULL,eta=NULL",
    "target_stop_id=target_stop_id,eta=NULL",
  ],
  [
    "retain-active-eta",
    "route-work.ts",
    "eta=NULL,warehouse_depot_version=NULL",
    "eta=eta,warehouse_depot_version=NULL",
  ],
  [
    "do-not-advance-revision",
    "route-work.ts",
    "SET revision=revision+1 WHERE id=$1",
    "SET revision=revision WHERE id=$1",
  ],
  [
    "cancel-completed-work",
    "route-publications.ts",
    "if (finished.rowCount)",
    "if (false)",
  ],
  [
    "restart-completed-work",
    "route-start.ts",
    "if (finished.rowCount)",
    "if (false)",
  ],
];
const results = [];
try {
  for (const path of [
    "src/core",
    "tests/helpers",
    "tests/route-lifecycle.test.ts",
    "tests/route-lifecycle-integration.test.ts",
    "package.json",
  ])
    await cp(join(root, path), join(sandbox, path), { recursive: true });
  await symlink(
    join(root, "node_modules"),
    join(sandbox, "node_modules"),
    "junction",
  );
  await writeFile(
    join(sandbox, "vitest.config.mjs"),
    'export default {test:{include:["tests/route-lifecycle*.test.ts"],fileParallelism:false,maxWorkers:1,testTimeout:120000,hookTimeout:120000}};',
  );
  const originals = new Map(
    await Promise.all(
      [...new Set(cases.map((c) => c[1]))].map(async (file) => [
        file,
        await readFile(join(root, "src/core", file), "utf8"),
      ]),
    ),
  );
  async function run(name) {
    const report = join(sandbox, `${name}.json`);
    const code = await new Promise((done, fail) => {
      const child = spawn(
        process.execPath,
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
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
      assertionFailures: failures.length,
      failures: failures.map((a) => ({
        name: a.fullName,
        messages: a.failureMessages,
      })),
    };
  }
  const baseline = await run("baseline");
  console.log(JSON.stringify(baseline));
  if (baseline.code !== 0 || baseline.passed !== 4)
    throw new Error("BASELINE_FAILED");
  for (const [name, file, from, to] of cases) {
    const original = originals.get(file);
    if (original.split(from).length !== 2)
      throw new Error(`NON_UNIQUE_MUTATION: ${name}`);
    await writeFile(
      join(sandbox, "src/core", file),
      original.replace(from, to),
    );
    const result = await run(name);
    await writeFile(join(sandbox, "src/core", file), original);
    results.push({
      ...result,
      killed: result.code !== 0 && result.assertionFailures > 0,
    });
    console.log(JSON.stringify({ ...results.at(-1), failures: undefined }));
  }
  await mkdir(join(root, "reports/mutation"), { recursive: true });
  await writeFile(
    join(root, "reports/mutation/route-lifecycle-integration.json"),
    JSON.stringify({ baseline, results }, null, 2),
  );
  if (results.some((r) => !r.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (
    !within.startsWith("closure-mutants-") ||
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
