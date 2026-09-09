import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import ts from "typescript";

const metrics: { file: string; name: string; complexity: number }[] = [];
for (const file of await readdir("src/core")) {
  if (!file.endsWith(".ts")) continue;
  const ast = ts.createSourceFile(
    file,
    await readFile(join("src/core", file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  function walk(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.body) {
      let complexity = 1;
      function count(part: ts.Node) {
        if (part !== node && ts.isFunctionLike(part)) return;
        if (
          ts.isIfStatement(part) ||
          ts.isForStatement(part) ||
          ts.isForOfStatement(part) ||
          ts.isForInStatement(part) ||
          ts.isWhileStatement(part) ||
          ts.isDoStatement(part) ||
          ts.isCaseClause(part) ||
          ts.isCatchClause(part) ||
          ts.isConditionalExpression(part)
        )
          complexity++;
        if (
          ts.isBinaryExpression(part) &&
          [
            ts.SyntaxKind.AmpersandAmpersandToken,
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.QuestionQuestionToken,
          ].includes(part.operatorToken.kind)
        )
          complexity++;
        ts.forEachChild(part, count);
      }
      count(node);
      metrics.push({
        file: `src/core/${file}`,
        name: node.name?.text || "anonymous",
        complexity,
      });
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
}
const report = {
  method:
    "AST cyclomatic estimate for named core functions; nested callbacks measured separately only when named. Not a full-project complexity score.",
  maximum: Math.max(...metrics.map((m) => m.complexity)),
  functions: metrics,
};
await mkdir("reports", { recursive: true });
await writeFile("reports/complexity.json", JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    coreNamedFunctions: metrics.length,
    maximumEstimatedComplexity: report.maximum,
  }),
);

const previewPath = resolve(".local/preview-runtime.json");
try {
  const local = JSON.parse(await readFile(previewPath, "utf8"));
  const needles = [local.password, local.bootstrapToken].filter(
    (value: unknown) => typeof value === "string" && value.length >= 32,
  );
  let inspected = 0;
  async function inspect(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await inspect(path);
      else {
        const data = await readFile(path);
        inspected++;
        if (needles.some((secret) => data.includes(Buffer.from(secret))))
          throw new Error("PRIVATE_VALUE_IN_CLIENT_ARTIFACT");
      }
    }
  }
  await inspect(".next/static");
  console.log(
    JSON.stringify({
      clientArtifactFilesChecked: inspected,
      localSecretsExposed: false,
    }),
  );
} catch (error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "ENOENT"
  )
    throw error;
  console.log(
    "Local preview secret scan unavailable: no local preview settings.",
  );
}
