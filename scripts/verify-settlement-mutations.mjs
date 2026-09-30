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

// Real PostgreSQL, disposable copy; never mutate the checkout or an external service.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = join(root, ".local");
await mkdir(scratch, { recursive: true });
const sandbox = await mkdtemp(join(scratch, "settlement-mutants-"));
const cases = [
  [
    "payment-owner",
    "finance-context.ts",
    "driverId && row.driver_id !== driverId",
    "false",
  ],
  [
    "payment-replay-payload",
    "payments.ts",
    "previous.request_hash !== hash",
    "false",
  ],
  [
    "payment-reviewed-basis",
    "payments.ts",
    "detail.basis !== input.basis",
    "false",
  ],
  ["payment-delivery", "payments.ts", 'detail.status !== "delivered"', "false"],
  [
    "receipt-change-warning",
    "finance-read.ts",
    "p.basis !== order.basis",
    "false",
  ],
  ["finished-route", "settlements.ts", "!route.completed_at", "false"],
  [
    "pending-reservation",
    "settlements.ts",
    "selected.some((p) => pending.has(p.id))",
    "false",
  ],
  [
    "complete-payments",
    "settlements.ts",
    "if (missing.rowCount)",
    "if (false)",
  ],
  ["accepted-exclusion", "settlements.ts", "!accepted.has(p.id)", "true"],
  [
    "reviewed-reception",
    "settlements.ts",
    "financialHash(row.snapshot) !== raw.basis",
    "false",
  ],
  [
    "decision-replay-payload",
    "settlements.ts",
    "row.decision_hash !== hash",
    "false",
  ],
  [
    "reject-releases-reservation",
    "settlements.ts",
    'if (raw.decision === "rejected")',
    "if (false)",
  ],
  [
    "receipt-immutable",
    "payment-schema.ts",
    "BEFORE UPDATE OR DELETE ON route_order_payments",
    "BEFORE DELETE ON route_order_payments",
  ],
  [
    "claim-preserves-accepted",
    "settlement-schema.ts",
    "id=OLD.request_id AND status='rejected'",
    "id=OLD.request_id",
  ],
];
const results = [];
try {
  for (const path of [
    "src/core",
    "tests/helpers",
    "tests/payments-integration.test.ts",
    "tests/settlements-integration.test.ts",
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
    'export default {test:{include:["tests/payments-integration.test.ts","tests/settlements-integration.test.ts"],fileParallelism:false,testTimeout:60000,hookTimeout:120000}};',
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
  if (baseline.code !== 0 || baseline.passed !== 7)
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
    join(root, "reports/mutation/settlements-integration.json"),
    JSON.stringify({ baseline, results }, null, 2),
  );
  if (results.some((r) => !r.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (
    !within.startsWith("settlement-mutants-") ||
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
