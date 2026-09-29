import { defineConfig } from "vitest/config";

export default defineConfig({ test: {
  include: ["tests/product-incident-admin-cancel.test.ts"],
  testNamePattern: "administration cancels open|administration removes reports from a deleted plan|holds execution and stop locks",
  fileParallelism: false,
} });
