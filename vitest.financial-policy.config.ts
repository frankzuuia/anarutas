import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/financial-policy.test.ts",
      "tests/odoo-financial-contract.test.ts",
    ],
    fileParallelism: false,
  },
});
