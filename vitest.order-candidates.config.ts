import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/order-candidates-validation.test.ts",
      "tests/order-candidates.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
