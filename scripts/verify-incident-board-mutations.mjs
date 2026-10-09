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
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  scratch = join(root, ".local");
await mkdir(scratch, { recursive: true });
const sandbox = await mkdtemp(join(scratch, "incident-board-mutants-"));
const board = "src/core/incident-board.ts",
  schema = "src/core/incident-board-schema.ts";
const test = "tests/incident-board.test.ts";
const cases = [
  [
    "overwrite-first-seen",
    board,
    "WHERE sequence=$1 AND seen_at IS NULL RETURNING sequence",
    "WHERE sequence=$1 RETURNING sequence",
  ],
  ["duplicate-seen-audit", board, "if (changed.rowCount)", "if (true)"],
  [
    "spoof-seen-fields",
    board,
    'Object.keys(raw).some((key) => key !== "key")',
    "false",
  ],
  ["settings-lost-update", board, "before.version !== input.version", "false"],
  [
    "invalid-seconds",
    board,
    "![5, 10, 15].includes(raw.seconds as number)",
    "false",
  ],
  [
    "duplicate-cursor-event",
    board,
    "WHERE n.sequence>$1 ORDER BY n.sequence LIMIT 101",
    "WHERE n.sequence>=$1 ORDER BY n.sequence LIMIT 101",
  ],
  [
    "acknowledged-alert",
    board,
    "n.seen_at IS NULL AND e.id IS NOT NULL AS pending",
    "e.id IS NOT NULL AS pending",
  ],
  [
    "page-skips-backlog",
    board,
    "cursor: page.length > 100 ? taken.at(-1)!.sequence : latest",
    "cursor: latest",
  ],
  ["same-filter-leak", board, "value.filterHash !== filterHash", "false"],
  [
    "board-unseen-filter",
    board,
    "AND (NOT $5::boolean OR ${unseen})",
    "AND (NOT $5::boolean OR true)",
  ],
  [
    "return-absent-live",
    schema,
    "WHERE i.status='pending' AND i.report_removed_at IS NULL",
    "WHERE i.status='pending' AND i.report_removed_at IS NULL AND i.kind<>'return'",
  ],
  ["empty-admin-comment", schema, "COALESCE(a.comment,i.note)", "i.note"],
  [
    "late-without-alert",
    schema,
    "IF NEW.incident_kind IS DISTINCT FROM 'late_arrival' THEN RETURN NULL; END IF;",
    "RETURN NULL;",
  ],
  [
    "unserialized-commit",
    schema,
    "PERFORM pg_advisory_xact_lock(hashtext('ana-rutas:incident-notification-order'));",
    "PERFORM 1;",
  ],
];
try {
  for (const path of [
    "src/core",
    "src/server",
    "tests/helpers",
    test,
    "package.json",
  ])
    await cp(join(root, path), join(sandbox, path), { recursive: true });
  await mkdir(join(sandbox, ".local"), { recursive: true });
  await symlink(
    join(root, "node_modules"),
    join(sandbox, "node_modules"),
    "junction",
  );
  await writeFile(
    join(sandbox, "vitest.config.mjs"),
    "export default {test:{fileParallelism:false,testTimeout:60000,hookTimeout:60000}};",
  );
  const originals = new Map(
    await Promise.all(
      [...new Set(cases.map((c) => c[1]))].map(async (path) => [
        path,
        await readFile(join(root, path), "utf8"),
      ]),
    ),
  );
  const run = async (name) => {
    const report = join(sandbox, name + ".json");
    const code = await new Promise((done, fail) => {
      const child = spawn(
        process.execPath,
        [
          join(root, "node_modules/vitest/vitest.mjs"),
          "run",
          test,
          "--reporter=json",
          "--outputFile=" + report,
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
  };
  for (const [name, path, from] of cases)
    if (originals.get(path).split(from).length !== 2)
      throw new Error("NON_UNIQUE_MUTATION: " + name);
  const baseline = await run("baseline");
  if (baseline.code !== 0 || baseline.passed !== 2)
    throw new Error("BASELINE_FAILED: " + JSON.stringify(baseline));
  console.log(JSON.stringify(baseline));
  const results = [];
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
    join(root, "reports/mutation/incident-board.json"),
    JSON.stringify({ baseline, results }, null, 2),
  );
  if (results.some((result) => !result.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (
    !within.startsWith("incident-board-mutants-") ||
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
