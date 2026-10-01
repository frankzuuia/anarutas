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
const sandbox = await mkdtemp(join(scratch, "warehouse-mutants-"));
const cases = [
  [
    "server-warehouse-restoration",
    "settlement-warehouse-policy.ts",
    "return rows[0].settlement_require_warehouse as boolean",
    "return false",
  ],
  [
    "settings-fail-closed",
    "settlement-warehouse-policy.ts",
    'typeof rows[0]?.settlement_require_warehouse !== "boolean"',
    "false",
  ],
  [
    "sql-reception-warehouse",
    "order-collection-schema.ts",
    "NOT route_settlement_ready(NEW.execution_id)",
    "false",
  ],
  [
    "sql-work-warehouse",
    "route-work-schema.ts",
    "NOT route_settlement_ready(NEW.execution_id)",
    "false",
  ],
  [
    "sql-unfinished-orders",
    "settlement-warehouse-schema.ts",
    "AND NOT EXISTS(SELECT 1 FROM route_driver_execution_orders WHERE execution_id=target AND status<>'delivered')",
    "",
  ],
  [
    "sql-uncaptured-orders",
    "settlement-warehouse-schema.ts",
    "AND NOT EXISTS(SELECT 1 FROM route_driver_execution_orders o WHERE o.execution_id=target\n            AND NOT EXISTS(SELECT 1 FROM route_order_payments p WHERE (p.execution_id,p.shipment_id)=(o.execution_id,o.shipment_id)))",
    "",
  ],
  [
    "explicit-test-default",
    "settlement-warehouse-schema.ts",
    "settlement_require_warehouse boolean NOT NULL DEFAULT false",
    "settlement_require_warehouse boolean NOT NULL DEFAULT true",
  ],
];
const results = [];
try {
  for (const path of [
    "src/core",
    "tests/helpers",
    "tests/settlement-warehouse-integration.test.ts",
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
    'export default {test:{include:["tests/settlement-warehouse-integration.test.ts"],fileParallelism:false,maxWorkers:1,testTimeout:120000,hookTimeout:120000}};',
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
  if (baseline.code !== 0 || baseline.passed !== 2)
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
    join(root, "reports/mutation/warehouse-integration.json"),
    JSON.stringify({ baseline, results }, null, 2),
  );
  if (results.some((r) => !r.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (
    !within.startsWith("warehouse-mutants-") ||
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
