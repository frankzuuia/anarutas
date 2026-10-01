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
const sandbox = await mkdtemp(join(scratch, "draft-source-mutants-"));
const cases = [
  [
    "plan-lock",
    "draft-source-sync.ts",
    "ORDER BY p.id FOR UPDATE",
    "ORDER BY p.id",
  ],
  ["archive-guard", "draft-source-sync.ts", "p.archived_at IS NULL", "true"],
  ["started-lane", "draft-source-sync.ts", "AND NOT EXISTS (", "AND EXISTS ("],
  [
    "unstarted-lane",
    "draft-source-sync.ts",
    "AND pub.started_at IS NOT NULL",
    "",
  ],
  [
    "identity-selection",
    "draft-source-sync.ts",
    "AND (s.source,s.picking_id,s.order_id)=($2,$3,$4)",
    "AND s.source=$2",
  ],
  [
    "repeated-source",
    "draft-source-sync.ts",
    "if (hash === financialHash(row.snapshot))",
    "if (false)",
  ],
  [
    "plan-version",
    "draft-source-sync.ts",
    "SET version=version+1,updated_at=now()",
    "SET version=version,updated_at=now()",
  ],
  ["change-count", "draft-source-sync.ts", "updated++;", "updated += 0;"],
  [
    "publication-start-guard",
    "route-start.ts",
    "if (\n      routePublicationSourceChanged(",
    "if (\n      false && routePublicationSourceChanged(",
  ],
];
const results = [];
try {
  for (const path of [
    "src/core",
    "tests/helpers",
    "tests/draft-source-sync.test.ts",
    "tests/draft-source-policy.test.ts",
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
    'export default {test:{include:["tests/draft-source-sync.test.ts","tests/draft-source-policy.test.ts"],fileParallelism:false,testTimeout:120000,hookTimeout:120000}};',
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
  if (baseline.code !== 0 || baseline.passed !== 10)
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
    join(root, "reports/mutation/draft-source-integration.json"),
    JSON.stringify({ baseline, results }, null, 2),
  );
  if (results.some((r) => !r.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (
    !within.startsWith("draft-source-mutants-") ||
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
