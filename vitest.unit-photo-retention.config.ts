import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit-photo-retention.test.ts", "tests/route-publications.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/core/unit-photos.ts", "src/core/unit-photo-retention*.ts", "src/server/unit-photo-cleanup.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "reports/coverage/unit-photo-retention",
      // All new scheduling branches and the migration must be covered. The
      // older image API also contains defensive filesystem race callbacks.
      thresholds: {
        lines: 95, functions: 75, branches: 85, statements: 90,
        "src/core/unit-photo-retention*.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
        "src/server/unit-photo-cleanup.ts": { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
  },
});
