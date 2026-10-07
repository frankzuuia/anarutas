import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/unloading-learning.test.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    coverage: {
      provider: "v8",
      include: [
        "src/core/unloading-learning.ts",
        "src/core/unloading-learning-schema.ts",
      ],
      reportsDirectory: "reports/coverage/unloading-learning",
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        lines: 100,
        statements: 100,
        branches: 100,
        functions: 100,
      },
    },
  },
});
