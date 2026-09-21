import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/google-consumption.test.ts",
      "tests/google-consumption-persistence.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
