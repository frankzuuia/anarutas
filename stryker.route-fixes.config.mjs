import base from "./stryker.base.config.mjs";
const config = { ...base,
  mutate: ["src/core/product-thumbnails.ts:21:58-21:69", "src/core/route-publication-revisions.ts"],
  testRunner: "vitest", vitest: { configFile: "vitest.route-fixes.config.ts" },
  reporters: ["clear-text", "json"], jsonReporter: { fileName: "reports/mutation/route-fixes.json" },
  concurrency: 2, coverageAnalysis: "perTest", thresholds: { high: 100, low: 100, break: 100 } };
export default config;
