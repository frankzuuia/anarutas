import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/draft-source-policy.test.ts",
      "tests/route-publication-content.test.ts",
    ],
  },
});
