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
const sandbox = await mkdtemp(join(scratch, "zone-time-mutants-"));
const cases = [
  [
    "pin-all-to-first-truck",
    "route-google-direct.ts",
    "costsPerVehicle: geographicCosts.get(group.id)!",
    "allowedVehicleIndices: [0]",
  ],
  [
    "omit-geographical-costs",
    "route-google-direct.ts",
    "costsPerVehicle: geographicCosts.get(group.id)!",
    "costsPerVehicle: undefined",
  ],
  [
    "ignore-wait-service-objective",
    "route-google-direct.ts",
    "vehicle.costPerHour = vehicle.costPerTraveledHour",
    "vehicle.costPerHour = 0",
  ],
  [
    "fixed-three-vehicle-centers",
    "route-zones.ts",
    "const reference = vehicleIds.map(",
    "const reference = vehicleIds.slice(0, 3).map(",
  ],
  [
    "ignore-vehicle-identity",
    "route-zones.ts",
    "centers.get(id) ?? populated[index % populated.length]",
    "populated[0]",
  ],
  [
    "ignore-distance",
    "route-zones.ts",
    "distances.map((km) => Math.max(0, km - nearest))",
    "distances.map(() => 0)",
  ],
  ["negative-costs", "route-zones.ts", "km - nearest", "nearest - km"],
  [
    "omit-vehicle-index-guard",
    "route-google-direct.ts",
    "!Number.isSafeInteger(route.vehicleIndex) ||\n      !request.model.vehicles[route.vehicleIndex]",
    "false",
  ],
  [
    "unknown-shipment-accepted",
    "route-google-direct.ts",
    "!shipment ||",
    "false ||",
  ],
  [
    "ignore-forecast-lateness",
    "route-time-conflicts.ts",
    "if (!(stop.lateSeconds && stop.lateSeconds > 0)) return [];",
    "if (true) return [];",
  ],
  [
    "late-minute-rounding",
    "route-time-conflicts.ts",
    "Math.ceil(stop.lateSeconds / 60)",
    "Math.floor(stop.lateSeconds / 60)",
  ],
  [
    "ignore-truck-filter",
    "route-time-conflicts.ts",
    "selectRouteMapView(board, optimization, filter)",
    "selectRouteMapView(board, optimization, 'all')",
  ],
  [
    "stale-forecast-warning",
    "route-map-selection.ts",
    "optimization?.current &&",
    "true &&",
  ],
  [
    "wrong-plan-warning",
    "route-map-selection.ts",
    "optimization.planId === board.plan.id &&",
    "true &&",
  ],
  [
    "wrong-version-warning",
    "route-map-selection.ts",
    "optimization.appliedPlanVersion === board.plan.version",
    "true",
  ],
];
const testFiles = [
  "route-zone-time.test.ts",
  "route-google-direct.test.ts",
  "route-zones-service.test.ts",
  "route-map-selection.test.ts",
];
const results = [];
try {
  for (const path of [
    "src/core",
    "tests/helpers",
    "package.json",
    ...testFiles.map((file) => `tests/${file}`),
  ])
    await cp(join(root, path), join(sandbox, path), { recursive: true });
  await symlink(
    join(root, "node_modules"),
    join(sandbox, "node_modules"),
    "junction",
  );
  await writeFile(
    join(sandbox, "vitest.config.mjs"),
    `export default {test:{include:${JSON.stringify(testFiles.map((file) => `tests/${file}`))},fileParallelism:false,maxWorkers:1}};`,
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
  if (baseline.code !== 0 || !baseline.passed)
    throw Error("ZONE_TIME_MUTATION_BASELINE_FAILED");
  console.log(JSON.stringify(baseline));
  for (const [name, file, from, to] of cases) {
    const original = originals.get(file);
    if (original.split(from).length !== 2)
      throw Error(`MUTATION_TARGET_NOT_UNIQUE:${name}`);
    await writeFile(
      join(sandbox, "src/core", file),
      original.replace(from, to),
    );
    const result = await run(name);
    results.push({
      ...result,
      killed: result.code !== 0 && result.assertionFailures > 0,
    });
    console.log(JSON.stringify(results.at(-1)));
    await writeFile(join(sandbox, "src/core", file), original);
  }
  const report = {
    baseline,
    results,
    killed: results.filter((r) => r.killed).length,
    total: results.length,
  };
  await mkdir(join(root, "reports/mutation"), { recursive: true });
  await writeFile(
    join(root, "reports/mutation/zone-time.json"),
    JSON.stringify(report, null, 2),
  );
  if (report.killed !== report.total) throw Error("ZONE_TIME_MUTANT_SURVIVED");
} finally {
  const target = relative(scratch, sandbox);
  if (
    !target ||
    target.startsWith("..") ||
    !target.startsWith("zone-time-mutants-")
  )
    throw Error("UNSAFE_MUTATION_CLEANUP");
  await rm(sandbox, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
