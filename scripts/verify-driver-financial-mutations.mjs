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
const sandbox = await mkdtemp(join(scratch, "driver-financial-mutants-"));
const store = "src/core/driver-financial-store.ts",
  schema = "src/core/incident-financial-schema.ts";
const cases = [
  [
    "expected-revision",
    store,
    "source.revision !== expected.revision",
    "false",
  ],
  [
    "freshness",
    store,
    "now.getTime() - checked > financialSyncConfig().freshSeconds * 1000",
    "false",
  ],
  ["source-error", store, "source.last_error !== null ||", "false ||"],
  ["move-identity", store, "identity.id !== expected.moveId ||", "false ||"],
  [
    "sale-identity",
    store,
    "identity.saleLineId !== expected.saleLineId",
    "false",
  ],
  [
    "sql-quantity-limit",
    schema,
    "IF total+NEW.quantity>NEW.source_quantity THEN",
    "IF false THEN",
  ],
];
const results = [];
try {
  for (const path of [
    "src/core",
    "tests/helpers",
    "tests/driver-financial-integration.test.ts",
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
    'export default {test:{include:["tests/driver-financial-integration.test.ts"],fileParallelism:false,testTimeout:60000,hookTimeout:120000}};',
  );
  const originals = new Map(
    await Promise.all(
      [...new Set(cases.map((item) => item[1]))].map(async (path) => [
        path,
        await readFile(join(root, path), "utf8"),
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
    };
  }
  const baseline = await run("baseline");
  if (baseline.code !== 0 || baseline.passed !== 4)
    throw new Error(`BASELINE_FAILED: ${JSON.stringify(baseline)}`);
  console.log(JSON.stringify(baseline));
  for (const [name, path, from, to] of cases) {
    const original = originals.get(path);
    if (original.split(from).length !== 2)
      throw new Error(`NON_UNIQUE_MUTATION: ${name}`);
    await writeFile(join(sandbox, path), original.replace(from, to));
    const result = await run(name);
    await writeFile(join(sandbox, path), original);
    results.push({ ...result, killed: result.code !== 0 && result.failed > 0 });
    console.log(JSON.stringify(results.at(-1)));
  }
  await mkdir(join(root, "reports/mutation"), { recursive: true });
  await writeFile(
    join(root, "reports/mutation/driver-financial-integration.json"),
    JSON.stringify({ baseline, results }, null, 2),
  );
  if (results.some((result) => !result.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (
    !within.startsWith("driver-financial-mutants-") ||
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
