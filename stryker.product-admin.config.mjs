import base from "./stryker.base.config.mjs";
const config = { ...base, mutate: ["src/core/product-incident-admin-cancel.ts:19-25"],
  testRunner: "vitest", vitest: { configFile: "vitest.product-admin.config.ts" },
  reporters: ["clear-text", "json"], jsonReporter: { fileName: "reports/mutation/product-admin.json" },
  concurrency: 2, coverageAnalysis: "perTest", thresholds: { high: 100, low: 95, break: 95 } };
export default config;
