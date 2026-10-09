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
const target = process.argv[2];
if (!["server", "android"].includes(target))
  throw new Error("Use server or android");
const android = target === "android",
  scratch = join(root, ".local");
await mkdir(scratch, { recursive: true });
const sandbox = await mkdtemp(join(scratch, "incident-resolution-mutants-"));
const board = "src/core/incident-board.ts",
  source = "src/core/incident-board-resolved-source.ts";
const policy =
  "driver-app/app/src/main/java/com/five/anarutas/driver/IncidentReceiptPolicy.kt";
const test = "tests/incident-resolution-board.test.ts";
const cases = android
  ? [
      ["unverified", policy, "!state.verified || ", ""],
      ["busy", policy, "state.busy || ", ""],
      ["pending", policy, "state.pending || ", ""],
      ["retired", policy, "state.retired || ", ""],
      [
        "old-receipt",
        policy,
        "state.productRevision <= previousRevision",
        "false",
      ],
      ["wrong-stop", policy, "state.lastProductStopId != stopId", "false"],
      [
        "wrong-order",
        policy,
        "state.lastProductShipmentId != shipmentId",
        "false",
      ],
      ["wrong-edit", policy, "incidentId == editingIncidentId", "true"],
      [
        "invalid-receipt",
        policy,
        "confirmedIncidentReceipt(true, state.lastProductIncidentId)",
        "state.lastProductIncidentId",
      ],
    ]
  : [
      ["resolved-status", source, "i.status='resolved'", "i.status='pending'"],
      ["removed-report", source, "AND i.report_removed_at IS NULL", ""],
      [
        "resolution-note",
        source,
        "'resolutionNote',i.resolution_note",
        "'resolutionNote',NULL",
      ],
      [
        "already-resolved-action",
        source,
        "'canResolve',false",
        "'canResolve',true",
      ],
      [
        "service-status",
        source,
        "status='resolved_by_admin'",
        "status='completed'",
      ],
      [
        "resolved-seen",
        source,
        "resolved.source='product'",
        "resolved.source='service'",
      ],
      [
        "separate-source",
        board,
        'section === "resolved" ? sourceEntries(resolvedIncidentSource) : entries',
        "entries",
      ],
      ["service-in-active", board, "AND e.status<>'resolved_by_admin'", ""],
      ["cursor-isolation", board, "value.filterHash !== filterHash", "false"],
    ];
const results = [];
try {
  const paths = android
    ? [
        "driver-app/gradle",
        "driver-app/gradlew",
        "driver-app/gradlew.bat",
        "driver-app/gradle.properties",
        "driver-app/settings.gradle.kts",
        "driver-app/build.gradle.kts",
        "driver-app/app/build.gradle.kts",
        "driver-app/app/google-services.json",
        "driver-app/app/src",
      ]
    : ["src/core", "src/server", "tests/helpers", test, "package.json"];
  for (const path of paths)
    await cp(join(root, path), join(sandbox, path), { recursive: true });
  await mkdir(join(sandbox, ".local"), { recursive: true });
  if (!android) {
    await symlink(
      join(root, "node_modules"),
      join(sandbox, "node_modules"),
      "junction",
    );
    await writeFile(
      join(sandbox, "vitest.config.mjs"),
      "export default {test:{fileParallelism:false,testTimeout:60000,hookTimeout:60000}};",
    );
  }
  const originals = new Map(
    await Promise.all(
      [...new Set(cases.map((c) => c[1]))].map(async (path) => [
        path,
        await readFile(join(root, path), "utf8"),
      ]),
    ),
  );
  for (const [name, path, from] of cases)
    if (originals.get(path).split(from).length !== 2)
      throw new Error("NON_UNIQUE_MUTATION: " + name);
  const run = async (name) => {
    const report = join(sandbox, name + ".json"),
      log = join(sandbox, name + ".log");
    const command = android ? "cmd.exe" : process.execPath;
    const args = android
      ? [
          "/d",
          "/c",
          "gradlew.bat",
          "testDebugUnitTest",
          "--tests",
          "com.five.anarutas.driver.IncidentReceiptPolicyTest",
          "--console=plain",
        ]
      : [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          test,
          "--reporter=json",
          "--outputFile=" + report,
        ];
    let output = "";
    const code = await new Promise((done, fail) => {
      const child = spawn(command, args, {
        cwd: android ? join(sandbox, "driver-app") : sandbox,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (data) => (output += data));
      child.stderr.on("data", (data) => (output += data));
      child.on("error", fail);
      child.on("exit", done);
    });
    await writeFile(log, output);
    if (!android) {
      const summary = JSON.parse(await readFile(report, "utf8"));
      return {
        name,
        code,
        passed: summary.numPassedTests,
        failed: summary.numFailedTests,
      };
    }
    const xml = await readFile(
      join(
        sandbox,
        "driver-app/app/build/test-results/testDebugUnitTest/TEST-com.five.anarutas.driver.IncidentReceiptPolicyTest.xml",
      ),
      "utf8",
    );
    const attribute = (name) => Number(xml.split(name + '="')[1].split('"')[0]);
    const failed = attribute("failures") + attribute("errors");
    return { name, code, passed: attribute("tests") - failed, failed };
  };
  const baseline = await run("baseline");
  if (baseline.code !== 0 || baseline.passed !== (android ? 6 : 2))
    throw new Error("BASELINE_FAILED: " + JSON.stringify(baseline));
  console.log(JSON.stringify(baseline));
  for (const [name, path, from, to] of cases) {
    const original = originals.get(path);
    await writeFile(join(sandbox, path), original.replace(from, to));
    const result = await run(name);
    await writeFile(join(sandbox, path), original);
    results.push({ ...result, killed: result.code !== 0 && result.failed > 0 });
    console.log(JSON.stringify(results.at(-1)));
  }
  await mkdir(join(root, "reports/mutation"), { recursive: true });
  await writeFile(
    join(root, "reports/mutation/incident-resolution-" + target + ".json"),
    JSON.stringify({ baseline, results }, null, 2),
  );
  if (results.some((result) => !result.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (
    !within.startsWith("incident-resolution-mutants-") ||
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
