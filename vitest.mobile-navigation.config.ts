import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/navigation-hit-test.test.ts",
      "tests/navigation-focus.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "src/components/navigation-hit-test.ts",
        "src/components/navigation-focus.ts",
      ],
      reporter: ["text", "json-summary", "json"],
      reportsDirectory: "coverage/mobile-navigation",
      thresholds: {
        lines: 100,
        statements: 100,
        branches: 100,
        functions: 100,
      },
    },
  },
});
