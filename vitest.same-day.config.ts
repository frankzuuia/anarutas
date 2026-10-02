import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/plan-creation*.test.ts",
      "tests/same-day-routes.test.ts",
      "tests/route-lifecycle.test.ts",
      "tests/integration.test.ts",
    ],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60000,
    hookTimeout: 60000,
    coverage: {
      provider: "v8",
      reportsDirectory: "reports/coverage/same-day",
      include: [
        "src/core/plans.ts",
        "src/core/plan-creation-schema.ts",
        "src/core/route-start-resources.ts",
        "src/core/route-lifecycle.ts",
        "src/components/plan-creation-attempt.ts",
      ],
      reporter: ["text", "json", "json-summary", "html"],
      thresholds: { lines: 90, functions: 100, branches: 90, statements: 90 },
    },
  },
});
