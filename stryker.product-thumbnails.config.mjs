import base from "./stryker.base.config.mjs";
const config = { ...base,
  mutate: ["src/core/product-thumbnails.ts:31-33", "src/core/product-thumbnails.ts:41-44", "src/core/product-thumbnails.ts:54-54"],
  testRunner: "vitest", vitest: { configFile: "vitest.product-thumbnails.config.ts" },
  reporters: ["clear-text", "json"], jsonReporter: { fileName: "reports/mutation/product-thumbnails.json" },
  concurrency: 2, coverageAnalysis: "perTest", thresholds: { high: 100, low: 100, break: 100 } };
export default config;
