import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/route-delivery-groups.test.ts",
      "tests/route-ai-planner.test.ts",
      "tests/route-fingerprint.test.ts",
    ],
    fileParallelism: false,
  },
});
