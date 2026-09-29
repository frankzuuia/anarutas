import base from "./stryker.base.config.mjs";
export default { ...base, mutate: ["src/core/product-incidents.ts:114-126"],
  testRunner: "vitest", vitest: { configFile: "vitest.product-amendments.config.ts" },
  reporters: ["clear-text", "json"], jsonReporter: { fileName: "reports/mutation/product-amendments.json" },
  concurrency: 2, coverageAnalysis: "perTest", thresholds: { high: 100, low: 85, break: 85 } };
