import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/draft-source-policy.test.ts",
      "tests/draft-source-sync.test.ts",
      "tests/route-publication-content.test.ts",
    ],
    fileParallelism: false,
    hookTimeout: 120000,
    testTimeout: 60000,
    coverage: {
      provider: "v8",
      include: [
        "src/core/draft-source-sync.ts",
        "src/core/route-publication-content.ts",
      ],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/draft-source",
    },
  },
});
