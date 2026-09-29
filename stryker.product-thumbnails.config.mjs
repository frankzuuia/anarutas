import base from "./stryker.base.config.mjs";
const config = { ...base,
  mutate: ["src/core/product-thumbnails.ts:29-31", "src/core/product-thumbnails.ts:39-42", "src/core/product-thumbnails.ts:52-52"],
  testRunner: "vitest", vitest: { configFile: "vitest.product-thumbnails.config.ts" },
  reporters: ["clear-text", "json"], jsonReporter: { fileName: "reports/mutation/product-thumbnails.json" },
  concurrency: 2, coverageAnalysis: "perTest", thresholds: { high: 100, low: 100, break: 100 } };
export default config;
