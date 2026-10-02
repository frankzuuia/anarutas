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
const sandbox = await mkdtemp(join(scratch, "panel-validation-mutants-"));
const cases = [
  [
    "bypass-individual",
    "route-publications.ts",
    "if (requestedVehicleId && pendingValidationVehicles.length)",
    "if (false)",
  ],
  [
    "abort-all-on-pending",
    "route-publications.ts",
    "if (requestedVehicleId && pendingValidationVehicles.length)",
    "if (pendingValidationVehicles.length)",
  ],
  [
    "publish-pending-trucks",
    "route-publications.ts",
    "!pendingVehicleIds.has(vehicle.id)",
    "true",
  ],
  [
    "skip-validated-trucks",
    "route-publications.ts",
    "!pendingVehicleIds.has(vehicle.id)",
    "pendingVehicleIds.has(vehicle.id)",
  ],
  [
    "hide-skipped-report",
    "route-publications.ts",
    "skippedValidationVehicles: pendingValidationVehicles",
    "skippedValidationVehicles: []",
  ],
  [
    "foreign-truck-orders",
    "route-publication-validation.ts",
    "order.vehicle_id === vehicle.id",
    "true",
  ],
  [
    "check-only-first",
    "route-publication-validation.ts",
    "orders.filter((order) => order.vehicle_id === vehicle.id)",
    "orders.filter((order) => order.vehicle_id === vehicle.id).slice(0, 1)",
  ],
  [
    "hide-pending-trucks",
    "route-publication-validation.ts",
    "return pendingValidationOrders.length",
    "return false",
  ],
  [
    "wrong-vehicle-name",
    "route-publication-validation.ts",
    "vehicleName: vehicle.name",
    "vehicleName: vehicle.id",
  ],
  [
    "allow-unknown-status",
    "route-start-validation.ts",
    'order.fulfillmentStatus !== "validated"',
    'order.fulfillmentStatus === "pending_validation"',
  ],
];
const results = [];
try {
  for (const path of [
    "src/core",
    "tests/helpers",
    "tests/route-publication-validation.test.ts",
    "tests/route-publication-validation-integration.test.ts",
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
    'export default {test:{include:["tests/route-publication-validation*.test.ts"],fileParallelism:false,maxWorkers:1,testTimeout:120000,hookTimeout:120000}};',
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
        .flatMap((test) => test.assertionResults)
        .filter((test) => test.status === "failed").length,
    };
  }
  const baseline = await run("baseline");
  if (baseline.code !== 0 || baseline.passed !== 2)
    throw new Error("PANEL_MUTATION_BASELINE_FAILED");
  console.log(JSON.stringify(baseline));
  for (const [name, file, from, to] of cases) {
    const original = originals.get(file);
    if (original.split(from).length !== 2)
      throw new Error(`MUTATION_TARGET_NOT_UNIQUE:${name}`);
    await writeFile(
      join(sandbox, "src/core", file),
      original.replace(from, to),
    );
    const result = await run(name);
    result.killed = result.code !== 0 && result.assertionFailures > 0;
    results.push(result);
    console.log(JSON.stringify(result));
    await writeFile(join(sandbox, "src/core", file), original);
  }
  const report = {
    baseline,
    results,
    killed: results.filter((result) => result.killed).length,
    total: results.length,
  };
  await mkdir(join(root, "reports/mutation"), { recursive: true });
  await writeFile(
    join(root, "reports/mutation/panel-validation.json"),
    JSON.stringify(report, null, 2),
  );
  if (report.killed !== report.total) throw new Error("PANEL_MUTANT_SURVIVED");
} finally {
  const child = relative(scratch, sandbox);
  if (
    !child ||
    child.startsWith("..") ||
    !child.startsWith("panel-validation-mutants-")
  )
    throw new Error("UNSAFE_MUTATION_CLEANUP");
  await rm(sandbox, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
