import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/route-logistics-policy.test.ts",
      "tests/route-ai-planner.test.ts",
      "tests/route-request-cache.test.ts",
      "tests/route-incidents.test.ts",
    ],
    fileParallelism: false,
  },
});
