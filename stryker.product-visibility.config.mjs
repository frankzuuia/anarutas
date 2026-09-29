import base from "./stryker.base.config.mjs";
const config = { ...base, mutate: ["src/core/product-incidents.ts:171-173"],
  testRunner: "vitest", vitest: { configFile: "vitest.product-visibility.config.ts" },
  reporters: ["clear-text", "json"], jsonReporter: { fileName: "reports/mutation/product-visibility.json" },
  concurrency: 2, coverageAnalysis: "perTest", thresholds: { high: 100, low: 95, break: 95 } };
export default config;
