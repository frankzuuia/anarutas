import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/customers-validation.test.ts",
      "tests/odoo-partner-capabilities.test.ts",
    ],
    fileParallelism: false,
  },
});
