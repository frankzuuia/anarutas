import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/route-observability.test.ts"],
    fileParallelism: false,
  },
});
