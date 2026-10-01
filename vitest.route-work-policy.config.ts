import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/route-work-policy.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/core/route-work-policy.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/route-work",
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
});
