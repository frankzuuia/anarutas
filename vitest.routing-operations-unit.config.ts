import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/route-road.test.ts",
      "tests/route-logistics-policy.test.ts",
      "tests/route-ai-integration.test.ts",
      "tests/route-fingerprint.test.ts",
    ],
    fileParallelism: false,
  },
});
