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
const sandbox = await mkdtemp(join(scratch, "same-day-mutants-"));
const groups = {
  creation: ["tests/plan-creation.test.ts"],
  route: ["tests/same-day-routes.test.ts", "tests/route-lifecycle.test.ts"],
  form: ["tests/plan-creation-attempt.test.ts"],
};
const cases = [
  [
    "creation",
    "new-key-on-retry",
    "src/core/plans.ts",
    "uuid(input.commandId).toLowerCase()",
    "randomUUID()",
  ],
  [
    "creation",
    "uuid-alias-race",
    "src/core/plans.ts",
    "uuid(input.commandId).toLowerCase()",
    "uuid(input.commandId)",
  ],
  [
    "creation",
    "ignore-intent-key",
    "src/core/plans.ts",
    "WHERE actor_id=$1 AND command_id=$2",
    "WHERE actor_id=$1 AND $2::uuid IS NOT NULL",
  ],
  [
    "creation",
    "ignore-intent-owner",
    "src/core/plans.ts",
    "WHERE actor_id=$1 AND command_id=$2",
    "WHERE $1::uuid IS NOT NULL AND command_id=$2",
  ],
  [
    "creation",
    "ignore-creation-authorization",
    "src/core/plans.ts",
    "await assertActiveActor(client, actor);",
    "",
    "createPlan",
  ],
  [
    "creation",
    "skip-lock-wait",
    "src/core/plans.ts",
    "pg_advisory_xact_lock(hashtextextended",
    "pg_try_advisory_xact_lock(hashtextextended",
  ],
  [
    "creation",
    "ignore-date-conflict",
    "src/core/plans.ts",
    "prior.requested_date !== date",
    "false",
  ],
  [
    "creation",
    "ignore-label-conflict",
    "src/core/plans.ts",
    "prior.requested_label !== label",
    "false",
  ],
  [
    "creation",
    "replay-another-plan",
    "src/core/plans.ts",
    "WHERE id=$1 FOR SHARE",
    "WHERE id<>$1 FOR SHARE",
  ],
  [
    "creation",
    "delete-creation-tombstone",
    "src/core/plan-creation-schema.ts",
    "plan_id uuid NOT NULL UNIQUE,",
    "plan_id uuid NOT NULL UNIQUE REFERENCES route_plans(id) ON DELETE CASCADE,",
  ],
  [
    "creation",
    "keep-unique-operation-date",
    "src/core/plan-creation-schema.ts",
    "EXECUTE format('ALTER TABLE route_plans DROP CONSTRAINT %I',constraint_name);",
    "NULL;",
  ],
  [
    "creation",
    "reverse-operation-order",
    "src/core/plans.ts",
    "ORDER BY service_date DESC,created_at DESC,id DESC",
    "ORDER BY service_date ASC,created_at DESC,id DESC",
  ],
  [
    "creation",
    "unstable-operation-ties",
    "src/core/plans.ts",
    "ORDER BY service_date DESC,created_at DESC,id DESC",
    "ORDER BY service_date DESC,created_at DESC,id ASC",
  ],
  [
    "route",
    "bypass-resource-check",
    "src/core/route-start.ts",
    "await assertRouteResourcesFree(sql, driverId, route.vehicle_id);",
    "",
  ],
  [
    "route",
    "ignore-busy-driver",
    "src/core/route-start-resources.ts",
    "pub.started_driver_id=$1 OR pub.vehicle_id=$2",
    "$1::uuid IS NULL OR pub.vehicle_id=$2",
  ],
  [
    "route",
    "ignore-busy-vehicle",
    "src/core/route-start-resources.ts",
    "pub.started_driver_id=$1 OR pub.vehicle_id=$2",
    "pub.started_driver_id=$1 OR $2::uuid IS NULL",
  ],
  [
    "route",
    "free-resource-after-gps-only",
    "src/core/route-start-resources.ts",
    "route_driver_work_completions w",
    "route_driver_execution_completions w",
  ],
  [
    "route",
    "never-free-closed-resources",
    "src/core/route-start-resources.ts",
    "AND w.execution_id IS NULL",
    "AND true",
  ],
  [
    "route",
    "select-queued-over-started",
    "src/core/route-lifecycle.ts",
    "plan.started_at !== null",
    "plan.started_at === null",
  ],
  [
    "route",
    "include-finalized-today",
    "src/core/route-lifecycle.ts",
    "&& !plan.work_completed_at",
    "&& true",
  ],
  [
    "form",
    "duplicate-exact-form-retry",
    "src/components/plan-creation-attempt.ts",
    "previous?.date === date && previous.label === label",
    "false",
  ],
  [
    "form",
    "reuse-key-for-changed-label",
    "src/components/plan-creation-attempt.ts",
    "previous?.date === date && previous.label === label",
    "previous?.date === date",
  ],
];
const results = [],
  baselines = [];
try {
  for (const entry of [
    "src/core",
    "src/components/plan-creation-attempt.ts",
    "tests/helpers",
    "tests/plan-creation.test.ts",
    "tests/same-day-routes.test.ts",
    "tests/route-lifecycle.test.ts",
    "tests/plan-creation-attempt.test.ts",
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
    "export default {test:{fileParallelism:false,maxWorkers:1,testTimeout:120000,hookTimeout:120000}};",
  );
  const originals = new Map(
    await Promise.all(
      [...new Set(cases.map((c) => c[2]))].map(async (path) => [
        path,
        await readFile(join(root, path), "utf8"),
      ]),
    ),
  );
  async function run(group, name) {
    const report = join(sandbox, `${name}.json`);
    const code = await new Promise((done, fail) => {
      const child = spawn(
        process.execPath,
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          ...groups[group],
          "--reporter=json",
          `--outputFile=${report}`,
        ],
        {
          cwd: sandbox,
          windowsHide: true,
          stdio: "ignore",
        },
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
      group,
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
  for (const group of Object.keys(groups)) {
    const baseline = await run(group, `baseline-${group}`);
    baselines.push(baseline);
    console.log(JSON.stringify({ ...baseline, failures: undefined }));
    if (baseline.code !== 0 || baseline.passed === 0)
      throw new Error(`BASELINE_FAILED:${group}`);
  }
  for (const [group, name, path, from, to, scope] of cases) {
    const original = originals.get(path);
    const start = scope
      ? original.indexOf(`export async function ${scope}(`)
      : 0;
    const end = scope
      ? original.indexOf("export async function editPlan(", start)
      : original.length;
    if (start < 0 || end < 0) throw new Error(`INVALID_SCOPE:${name}`);
    const part = original.slice(start, end);
    if (part.split(from).length !== 2)
      throw new Error(`NON_UNIQUE_MUTATION:${name}`);
    const target = join(sandbox, path);
    await writeFile(
      target,
      original.slice(0, start) + part.replace(from, to) + original.slice(end),
    );
    const result = await run(group, name);
    await writeFile(target, original);
    results.push({
      ...result,
      killed: result.code !== 0 && result.assertionFailures > 0,
    });
    console.log(JSON.stringify({ ...results.at(-1), failures: undefined }));
  }
  await mkdir(join(root, "reports/mutation"), { recursive: true });
  await writeFile(
    join(root, "reports/mutation/same-day.json"),
    JSON.stringify({ baselines, results }, null, 2),
  );
  if (results.some((r) => !r.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (
    !within.startsWith("same-day-mutants-") ||
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
