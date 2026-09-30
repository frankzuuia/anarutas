import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/payment-policy.test.ts", "tests/account-role.test.ts"],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/core/payment-policy.ts", "src/core/account-role.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/payments",
    },
  },
});
