import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/route-zone-time.test.ts",
      "tests/route-zones-service.test.ts",
      "tests/route-google-direct.test.ts",
      "tests/route-map-selection.test.ts",
    ],
    coverage: {
      include: [
        "src/core/route-zones.ts",
        "src/core/route-google-direct.ts",
        "src/core/route-time-conflicts.ts",
      ],
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/zone-time-focused",
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
    },
  },
});
