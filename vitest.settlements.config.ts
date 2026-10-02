import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/payment-policy.test.ts",
      "tests/account-role.test.ts",
      "tests/payments-integration.test.ts",
      "tests/settlements-integration.test.ts",
      "tests/settlement-driver-filter.test.ts",
      "tests/order-collection-integration.test.ts",
      "tests/route-work-policy.test.ts",
      "tests/route-work-integration.test.ts",
      "tests/settlement-warehouse-integration.test.ts",
      "tests/route-lifecycle.test.ts",
      "tests/route-lifecycle-integration.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    coverage: {
      provider: "v8",
      include: [
        "src/core/payment-policy.ts",
        "src/core/account-role.ts",
        "src/core/payments.ts",
        "src/core/settlements.ts",
        "src/core/finance-context.ts",
        "src/core/finance-read.ts",
        "src/core/finance-evidence.ts",
        "src/core/route-work-policy.ts",
        "src/core/route-work.ts",
        "src/core/settlement-warehouse-policy.ts",
        "src/core/route-lifecycle.ts",
      ],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/settlements",
    },
  },
});
