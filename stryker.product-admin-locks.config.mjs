import base from "./stryker.product-admin.config.mjs";

const config = { ...base, mutate: ["src/core/product-incident-admin-cancel.ts:19-21"],
  vitest: { configFile: "vitest.product-admin-locks.config.ts" },
  jsonReporter: { fileName: "reports/mutation/product-admin-locks.json" },
  thresholds: { high: 100, low: 100, break: 100 } };
export default config;
