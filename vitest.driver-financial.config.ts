import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/driver-financial-policy.test.ts"],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: [
        "src/core/driver-financial-policy.ts",
        "src/core/financial-allocation.ts",
        "src/core/incident-financial-input.ts",
      ],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/driver-financial",
    },
  },
});
