import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/product-incidents.test.ts", "tests/product-incident-admin-cancel.test.ts"],
    testNamePattern: "amends and cancels real incidents|records real product incidents|administration only removes",
    fileParallelism: false,
  },
});
