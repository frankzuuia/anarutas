import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/route-google-direct.test.ts",
      "tests/route-fleet-budget.test.ts",
    ],
    fileParallelism: false,
  },
});
