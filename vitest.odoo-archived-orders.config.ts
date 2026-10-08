import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/odoo-archived-orders.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/core/odoo-archived-orders.ts"],
      reporter: ["text", "json-summary"],
      reportsDirectory: "reports/coverage/odoo-archived-orders",
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
