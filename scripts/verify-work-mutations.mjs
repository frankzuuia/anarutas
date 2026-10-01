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

// Each guard is removed in a disposable copy and tested against real PostgreSQL.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = join(root, ".local");
await mkdir(scratch, { recursive: true });
const sandbox = await mkdtemp(join(scratch, "work-mutants-"));
const cases = [
  [
    "work-owner",
    "finance-context.ts",
    "driverId && row.driver_id !== driverId",
    "false",
  ],
  [
    "work-reviewed-input",
    "route-work.ts",
    'typeof raw.basis !== "string" || raw.basis.length !== 64',
    "false",
  ],
  ["work-ready", "route-work.ts", "!review.eligible", "false"],
  ["work-reviewed-basis", "route-work.ts", "review.basis !== basis", "false"],
  [
    "work-command-payload",
    "route-work.ts",
    "prior.request_hash !== hash",
    "false",
  ],
  [
    "packet-reviewed-basis",
    "settlements.ts",
    "review.basis !== raw.basis",
    "false",
  ],
  [
    "work-sql-reception",
    "route-work-schema.ts",
    "OR EXISTS(SELECT 1 FROM route_order_payments p LEFT JOIN route_settlement_claims c ON c.payment_id=p.id\n          LEFT JOIN route_settlement_requests r ON r.id=c.request_id WHERE p.execution_id=NEW.execution_id AND r.status IS DISTINCT FROM 'accepted')",
    "",
  ],
  [
    "work-sql-totals",
    "route-work-schema.ts",
    "e.total IS DISTINCT FROM a.total",
    "false",
  ],
  [
    "work-immutable",
    "route-work-schema.ts",
    "BEFORE UPDATE OR DELETE ON route_driver_work_completions",
    "BEFORE DELETE ON route_driver_work_completions",
  ],
  [
    "work-own-notification",
    "driver-mobile-events.ts",
    "(SELECT count(*) FROM route_driver_work_completions WHERE driver_id=$1) AS work",
    "0 AS work",
  ],
];
const results = [];
try {
  for (const path of [
    "src/core",
    "tests/helpers",
    "tests/route-work-integration.test.ts",
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
    'export default {test:{include:["tests/route-work-integration.test.ts"],fileParallelism:false,maxWorkers:1,testTimeout:120000,hookTimeout:120000}};',
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
    return {
      name,
      code,
      passed: summary.numPassedTests,
      failed: summary.numFailedTests,
      assertionFailures: summary.testResults
        .flatMap((s) => s.assertionResults)
        .filter((a) => a.status === "failed").length,
    };
  }
  const baseline = await run("baseline");
  console.log(JSON.stringify(baseline));
  if (baseline.code !== 0 || baseline.passed !== 1)
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
    console.log(JSON.stringify(results.at(-1)));
  }
  await mkdir(join(root, "reports/mutation"), { recursive: true });
  await writeFile(
    join(root, "reports/mutation/work-integration.json"),
    JSON.stringify({ baseline, results }, null, 2),
  );
  if (results.some((r) => !r.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (
    !within.startsWith("work-mutants-") ||
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
