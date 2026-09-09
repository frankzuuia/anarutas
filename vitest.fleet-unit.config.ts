import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/fleet-validation.test.ts", "tests/document-body.test.ts"],
    fileParallelism: false,
  },
});
