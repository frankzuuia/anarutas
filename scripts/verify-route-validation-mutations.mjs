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
const sandbox = await mkdtemp(join(scratch, "validation-mutants-"));
const cases = [
  [
    "bypass-start",
    "route-start.ts",
    "if (pendingValidationOrders.length)",
    "if (false)",
  ],
  [
    "check-only-first",
    "route-start.ts",
    "routeStartPendingOrders(ownOrders)",
    "routeStartPendingOrders(ownOrders.slice(0, 1))",
  ],
  [
    "block-foreign-orders",
    "route-start.ts",
    "routeStartPendingOrders(ownOrders)",
    "routeStartPendingOrders(board.shipments)",
  ],
  [
    "invert-validation",
    "route-start-validation.ts",
    'order.fulfillmentStatus !== "validated"',
    'order.fulfillmentStatus === "validated"',
  ],
  [
    "wrong-folio",
    "route-start-validation.ts",
    "orderName: order.orderName",
    "orderName: order.id",
  ],
  [
    "ignore-vehicle",
    "route-start-validation.ts",
    "AND vehicle_id=$2",
    "AND $2::uuid IS NOT NULL",
  ],
  [
    "ignore-plan",
    "route-start-validation.ts",
    "WHERE plan_id=$1",
    "WHERE $1::uuid IS NOT NULL",
  ],
  [
    "empty-projection",
    "route-start-validation.ts",
    "return routeStartPendingOrders(rows);",
    "return [];",
  ],
  [
    "allow-null-projection",
    "route-start-validation.ts",
    "THEN snapshot->>'fulfillmentStatus'",
    "THEN COALESCE(snapshot->>'fulfillmentStatus','validated')",
  ],
  [
    "miss-validation-event",
    "driver-financial-store.ts",
    "row.fulfillment_status,",
    "null,",
  ],
];
const results = [];
try {
  for (const path of [
    "src/core",
    "tests/helpers",
    "tests/route-start-validation.test.ts",
    "tests/route-start-validation-integration.test.ts",
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
    'export default {test:{include:["tests/route-start-validation*.test.ts"],fileParallelism:false,maxWorkers:1,testTimeout:120000,hookTimeout:120000}};',
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
      .flatMap((suite) => suite.assertionResults)
      .filter((a) => a.status === "failed");
    return {
      name,
      code,
      passed: summary.numPassedTests,
      failed: summary.numFailedTests,
      assertionFailures: failures.length,
    };
  }
  const baseline = await run("baseline");
  console.log(JSON.stringify(baseline));
  if (baseline.code !== 0 || baseline.passed !== 3)
    throw new Error("BASELINE_FAILED");
  for (const [name, file, from, to] of cases) {
    const original = originals.get(file);
    if (original.split(from).length !== 2)
      throw new Error(`NON_UNIQUE_MUTATION:${name}`);
    const target = join(sandbox, "src/core", file);
    await writeFile(target, original.replace(from, to));
    const result = await run(name);
    await writeFile(target, original);
    results.push({
      ...result,
      killed: result.code !== 0 && result.assertionFailures > 0,
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  await mkdir(join(root, "reports/mutation"), { recursive: true });
  await writeFile(
    join(root, "reports/mutation/route-validation.json"),
    JSON.stringify({ baseline, results }, null, 2),
  );
  if (results.some((r) => !r.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (
    !within.startsWith("validation-mutants-") ||
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
