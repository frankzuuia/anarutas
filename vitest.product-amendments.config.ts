import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/product-incidents.test.ts"],
  testNamePattern: "amends and cancels real incidents", fileParallelism: false } });
