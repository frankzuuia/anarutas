import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import ts from "typescript";
import { odooPublicStatus } from "../src/core/odoo";
it("Odoo exposes no generic executor and permits only fixed read operations", async () => {
  const source = await readFile("src/core/odoo.ts", "utf8");
  const ast = ts.createSourceFile(
    "odoo.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const operations: string[][] = [];
  function walk(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "rpc") {
      const strings = node.arguments
        .filter(ts.isStringLiteral)
        .map((value) => value.text);
      if (strings.includes("execute_kw")) {
        const arr = node.arguments.find(ts.isArrayLiteralExpression)!;
        operations.push(
          arr.elements.filter(ts.isStringLiteral).map((value) => value.text),
        );
      } else {
        operations.push(strings);
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  expect(operations).toEqual([
    ["common", "version"],
    ["common", "authenticate"],
    ["res.users", "read"],
    ["res.company", "read"],
    ["common", "authenticate"],
    ["res.users", "read"],
    ["search_read"],
    ["fields_get"],
    ["search_read"],
  ]);
  const exported = ast.statements
    .filter(ts.isFunctionDeclaration)
    .filter((node) =>
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
    )
    .map((node) => node.name?.text);
  expect(exported).toEqual([
    "odooPublicStatus",
    "diagnoseOdoo",
    "readFulfilledPage",
    "readFulfilledByOrderNames",
    "readCustomerPage",
  ]);
  expect(source).not.toMatch(/"(write|create|unlink)"/);
});
it("missing connection returns no invented connected state or secrets", () => {
  expect(odooPublicStatus()).toEqual({ configured: false, mode: "read-only" });
});
