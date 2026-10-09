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
const sandbox = await mkdtemp(join(scratch, "odoo-return-mutants-"));
const policy = "src/core/odoo-return-policy.ts",
  store = "src/core/odoo-return-store.ts",
  schema = "src/core/odoo-return-schema.ts";
const tests = [
  "tests/odoo-return-policy.test.ts",
  "tests/odoo-return-store.test.ts",
];
const cases = [
  ["cross-source", policy, "request.source !== source", "false"],
  ["cross-company", policy, "request.companyId !== company", "false"],
  ["duplicate-move", policy, "ids.has(line.moveId)", "false"],
  [
    "quantity-overflow",
    policy,
    "new Decimal(returnQuantity(quantity)).gt(available)",
    "false",
  ],
  [
    "receipt-product",
    policy,
    "actual[0].productId !== line.productId",
    "false",
  ],
  [
    "receipt-quantity",
    policy,
    "!new Decimal(actual[0].quantity).eq(line.quantity)",
    "false",
  ],
  ["legacy-unit", policy, ".div(a).times(b)", ".times(a).div(b)"],
  [
    "canceled-return",
    store,
    "AND i.status<>'canceled' ORDER BY i.id",
    "ORDER BY i.id",
  ],
  [
    "capture-history",
    store,
    "i JOIN route_odoo_return_capture c ON c.incident_id=i.id AND c.source=$3",
    "i JOIN route_odoo_return_capture c ON c.source=$3",
  ],
  ["payment-scope", schema, "s.source=NEW.source", "true"],
  [
    "request-mutable",
    schema,
    "RAISE EXCEPTION 'ODOO_RETURN_REQUEST_IMMUTABLE' USING ERRCODE='42501';",
    "RETURN NEW;",
  ],
  [
    "creation-rewind",
    schema,
    "RAISE EXCEPTION 'ODOO_RETURN_IDENTITY_IMMUTABLE' USING ERRCODE='42501';",
    "RETURN NEW;",
  ],
];
try {
  for (const path of [
    "src/core",
    "src/server",
    "tests/helpers",
    ...tests,
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
    "export default {test:{fileParallelism:false,testTimeout:120000,hookTimeout:60000}};",
  );
  const originals = new Map(
    await Promise.all(
      [...new Set(cases.map((item) => item[1]))].map(async (path) => [
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
          ...tests,
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
      throw Error("NON_UNIQUE_MUTATION: " + name);
  const baseline = await run("baseline");
  if (baseline.code !== 0 || baseline.passed !== 7)
    throw Error("BASELINE_FAILED: " + JSON.stringify(baseline));
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
    join(root, "reports/mutation/odoo-returns.json"),
    JSON.stringify({ baseline, results }, null, 2),
  );
  if (results.some((item) => !item.killed)) process.exitCode = 1;
} finally {
  const within = relative(scratch, sandbox);
  if (
    !within.startsWith("odoo-return-mutants-") ||
    within.includes("..") ||
    resolve(sandbox) === resolve(scratch)
  )
    throw Error("UNSAFE_CLEANUP_PATH");
  await rm(sandbox, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
