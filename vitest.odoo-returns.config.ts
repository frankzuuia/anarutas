import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/odoo-return-policy.test.ts",
      "tests/odoo-return-store.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 60000,
    coverage: {
      provider: "v8",
      include: [
        "src/core/odoo-return-policy.ts",
        "src/core/odoo-return-config.ts",
      ],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/odoo-returns",
      thresholds: { lines: 100, functions: 100, branches: 95, statements: 100 },
    },
  },
});
