import base from "./stryker.product-thumbnails.config.mjs";
const config = { ...base, mutate: ["src/core/product-thumbnails.ts:52-52"],
  jsonReporter: { fileName: "reports/mutation/product-thumbnail-source.json" },
  thresholds: { high: 100, low: 100, break: 100 } };
export default config;
