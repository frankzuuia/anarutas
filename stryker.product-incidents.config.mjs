import base from "./stryker.base.config.mjs";
const config = { ...base, mutate: ["src/core/product-incidents-policy.ts", "src/core/plan-archive.ts:5-13"],
  testRunner: "vitest", vitest: { configFile: "vitest.product-incidents.config.ts" },
  reporters: ["clear-text", "json"], jsonReporter: { fileName: "reports/mutation/product-incidents.json" },
  concurrency: 2, coverageAnalysis: "perTest", thresholds: { high: 100, low: 95, break: 95 } };
export default config;
