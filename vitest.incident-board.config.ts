import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/incident-board.test.ts",
      "tests/incident-resolution-board.test.ts",
      "tests/incident-alarm-lifecycle.test.ts",
      "tests/panel-realtime-policy.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 60000,
    coverage: {
      provider: "v8",
      include: [
        "src/core/incident-board.ts",
        "src/core/incident-board-resolved-source.ts",
        "src/core/incident-board-policy.ts",
        "src/core/incident-board-schema.ts",
        "src/components/panel-realtime-policy.ts",
      ],
      reportsDirectory: "reports/coverage/incident-board",
      reporter: ["text", "json-summary", "html"],
      thresholds: { lines: 95, branches: 90, functions: 100, statements: 95 },
    },
  },
});
