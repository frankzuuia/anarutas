import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/product-incidents.test.ts"],
  testNamePattern: "validates positive|cuts at Sunday", fileParallelism: false } });
