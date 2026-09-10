import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/routing-config.test.ts",
      "tests/route-optimization-google.test.ts",
    ],
    fileParallelism: false,
  },
});
