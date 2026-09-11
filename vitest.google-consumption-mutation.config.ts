import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/google-consumption.test.ts"],
    fileParallelism: false,
  },
});
