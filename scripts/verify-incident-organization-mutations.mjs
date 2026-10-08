import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), scratch = join(root, ".local");
await mkdir(scratch, { recursive: true });
const sandbox = await mkdtemp(join(scratch, "incident-organization-mutants-"));
const form = "src/core/product-incident-form.ts", policy = "src/core/product-incidents-policy.ts";
const service = "src/core/product-incidents.ts", test = "tests/product-incident-organization.test.ts";
const cases = [
  ["legacy-wire-version", form, "formVersion: version,", "formVersion: 3,"],
  ["v3-disabled", form, "value === 2 || value === 3", "value === 2"],
  ["return-concept-required", form, 'version === 3 && raw.kind === "return"', "false"],
  ["wrong-comment-catalog", form, "productCommentsByKind[raw.kind as keyof typeof productCommentsByKind]", "Object.keys(incidentCommentNames)"],
  ["duplicate-comments", form, "new Set(raw.comments).size !== raw.comments.length", "false"],
  ["return-department-required", policy, 'raw.formVersion === 3 && kind === "return"', "false"],
  ["comment-length", policy, "Array.from(comment).length > 2000", "Array.from(comment).length > 2001"],
  ["extra-financial-fields", policy, '!["expectedVersion", "department", "concept", "comment"].includes(key)', "false"],
  ["return-without-photo", policy, 'kind !== "shortage_warehouse" &&', 'kind !== "shortage_warehouse" && kind !== "return" &&'],
  ["returns-enter-report", service, ': reportableProductIncidentKinds];', ': [...reportableProductIncidentKinds, "return"]];'],
  ["return-classification", service, "!reportableProductIncidentKinds.some(kind => kind === row.kind)", "false"],
  ["ignore-comment", service, "if (next.comment !== undefined)", "if (false)"],
  ["empty-comment-fallback", service, "note: row.admin_comment ?? row.note,", "note: row.admin_comment || row.note,"],
  ["concurrent-edit-guard", service, 'if (row.version !== version) throw new AppError("VERSION_CONFLICT", 409);', 'if (false) throw new AppError("VERSION_CONFLICT", 409);'],
  ["audit-comment-before", service, "comment: row.admin_comment },", "comment: undefined },"],
  ["admin-actor-audit", service, "[actor]);", "[incidentId]);"],
];
try {
  for (const path of ["src/core", "src/server", "tests/helpers", test, "package.json"])
    await cp(join(root, path), join(sandbox, path), { recursive: true });
  await symlink(join(root, "node_modules"), join(sandbox, "node_modules"), "junction");
  await writeFile(join(sandbox, "vitest.config.mjs"), "export default {test:{fileParallelism:false,testTimeout:120000,hookTimeout:120000}};\n");
  const originals = new Map(await Promise.all([...new Set(cases.map(c => c[1]))].map(async path => [path, await readFile(join(root, path), "utf8")])));
  const run = async name => {
    const report = join(sandbox, `${name}.json`);
    const code = await new Promise((done, fail) => {
      const child = spawn(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", test, "--reporter=json", `--outputFile=${report}`],
        { cwd: sandbox, windowsHide: true, stdio: "ignore" });
      child.on("error", fail); child.on("exit", done);
    });
    const summary = JSON.parse(await readFile(report, "utf8"));
    return { name, code, passed: summary.numPassedTests, failed: summary.numFailedTests };
  };
  for (const [name, path, from] of cases)
    if (originals.get(path).split(from).length !== 2) throw new Error(`NON_UNIQUE_MUTATION: ${name}`);
  const baseline = await run("baseline");
  if (baseline.code !== 0 || baseline.passed !== 4) throw new Error(`BASELINE_FAILED: ${JSON.stringify(baseline)}`);
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
  await writeFile(join(root, "reports/mutation/incident-organization.json"), JSON.stringify({ baseline, results }, null, 2));
  if (results.some(result => !result.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (!within.startsWith("incident-organization-mutants-") || within.includes("..") || resolve(sandbox) === resolve(scratch)) throw new Error("UNSAFE_CLEANUP_PATH");
  await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
