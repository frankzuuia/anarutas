import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/policy.test.ts",
      "tests/orders-validation.test.ts",
      "tests/odoo-capabilities.test.ts",
    ],
    fileParallelism: false,
  },
});
