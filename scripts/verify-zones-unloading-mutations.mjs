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
const sandbox = await mkdtemp(join(scratch, "zones-unloading-mutants-"));
const cases = [
  [
    "minutes-as-seconds",
    "route-service-time.ts",
    "sum + minutes * 60",
    "sum + minutes"
  ],
  [
    "double-service",
    "route-service-time.ts",
    "Math.max(customers.get(shipment.partnerId) ?? 0, minutes)",
    "(customers.get(shipment.partnerId) ?? 0) + minutes"
  ],
  [
    "negative-duration",
    "route-service-time.ts",
    "value < 0",
    "false"
  ],
  [
    "fraction-duration",
    "route-service-time.ts",
    "!Number.isSafeInteger(value)",
    "false"
  ],
  [
    "lose-revisits",
    "route-service-time.ts",
    "seconds.set(shipment.id, visitServiceSeconds(members))",
    "seconds.set(shipment.id, 0)"
  ],
  [
    "ignore-service-on-road",
    "route-road.ts",
    "instant += (serviceSeconds.get(shipment.id) ?? 0) * 1000",
    "instant += 0"
  ],
  [
    "one-zone-for-all",
    "route-zones.ts",
    "Math.min(points.length, vehicleIds.length)",
    "Math.min(points.length, 1)"
  ],
  [
    "far-away-zone",
    "route-zones.ts",
    "distance(point, center) < distance(point, centers[best])",
    "distance(point, center) > distance(point, centers[best])"
  ],
  [
    "google-unrestricted",
    "route-google-direct.ts",
    "allowedVehicleIndices: [assigned.get(group.id)!]",
    "allowedVehicleIndices: []"
  ],
  [
    "no-zone-response-guard",
    "route-google-direct.ts",
    "!shipment?.allowedVehicleIndices?.includes(route.vehicleIndex)",
    "false"
  ],
  [
    "lose-google-service",
    "route-google-direct.ts",
    "duration: `${visitServiceSeconds(group.shipmentIds.map(id => byId.get(id)!))}s`",
    "duration: \"0s\""
  ],
  [
    "forget-persisted-value",
    "customers.ts",
    "input.unloadingMinutes !== undefined",
    "false"
  ],
  [
    "legacy-erases-value",
    "customers.ts",
    "input.unloadingMinutes !== undefined",
    "true"
  ],
  [
    "miss-hash-change",
    "route-fingerprint.ts",
    "...(s.unloadingMinutes ? { unloadingMinutes: s.unloadingMinutes } : {})",
    "...{}"
  ]
];
const results = [];
try {
  for (const path of [
    "src/core",
    "tests/helpers",
    "tests/route-zones-service.test.ts",
    "tests/customer-unloading.test.ts",
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
    'export default {test:{include:["tests/route-zones-service.test.ts","tests/customer-unloading.test.ts"],fileParallelism:false,maxWorkers:1,testTimeout:120000,hookTimeout:120000}};',
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
          ...(name === "baseline" || ["forget-persisted-value", "legacy-erases-value", "miss-hash-change"].includes(name) ? [] : ["tests/route-zones-service.test.ts"]),
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
  if (baseline.code !== 0 || baseline.passed !== 13)
    throw new Error("ZONES_MUTATION_BASELINE_FAILED");
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
    join(root, "reports/mutation/zones-unloading.json"),
    JSON.stringify(report, null, 2),
  );
  if (report.killed !== report.total) throw new Error("ZONES_MUTANT_SURVIVED");
} finally {
  const child = relative(scratch, sandbox);
  if (
    !child ||
    child.startsWith("..") ||
    !child.startsWith("zones-unloading-mutants-")
  )
    throw new Error("UNSAFE_MUTATION_CLEANUP");
  await rm(sandbox, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
