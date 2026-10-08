import { defineConfig } from "vitest/config";

export default defineConfig({ test: {
  include: ["tests/product-incident-organization.test.ts", "tests/product-incident-form.test.ts", "tests/product-incidents.test.ts",
    "tests/product-incident-photos.test.ts", "tests/product-incident-admin-cancel.test.ts",
    "tests/driver-financial-integration.test.ts", "tests/payments-integration.test.ts", "tests/order-collection-integration.test.ts"],
  fileParallelism: false, testTimeout: 120000, hookTimeout: 60000,
  coverage: { provider: "v8", include: ["src/core/product-incident-form.ts", "src/core/product-incidents-policy.ts",
    "src/core/product-incident-report-schema.ts", "src/core/product-incidents.ts", "src/server/product-photos-body.ts"],
    reporter: ["text", "json-summary", "html"], reportsDirectory: "reports/coverage/incident-organization",
    thresholds: { lines: 95, branches: 95, functions: 100, statements: 95 } },
} });
