import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/product-incidents.test.ts", "tests/product-incident-form.test.ts"],
  testNamePattern: "validates positive|cuts at Sunday|validates the v2", fileParallelism: false } });
