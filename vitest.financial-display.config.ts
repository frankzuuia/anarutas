import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/financial-display.test.ts",
      "tests/collection-receipt-order.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "src/core/financial-display.ts",
        "src/core/incident-financial-display.ts",
        "src/core/collection-receipt-order.ts",
      ],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/financial-display",
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 95 },
    },
  },
});
