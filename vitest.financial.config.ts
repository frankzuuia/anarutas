import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/financial-policy.test.ts",
      "tests/financial-store.test.ts",
      "tests/odoo-financial-contract.test.ts",
      "tests/financial-odoo-live.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
    coverage: {
      provider: "v8",
      include: [
        "src/core/financial-*.ts",
        "src/core/odoo-financial-contract.ts",
        "src/core/odoo-retry.ts",
      ],
      exclude: ["src/core/financial-contract.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/financial",
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
