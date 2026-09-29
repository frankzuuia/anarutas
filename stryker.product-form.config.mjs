import base from "./stryker.base.config.mjs";
const config = { ...base, mutate: ["src/core/product-incident-form.ts", "src/server/product-photos-body.ts"],
  testRunner: "vitest", vitest: { configFile: "vitest.product-form.config.ts" },
  reporters: ["clear-text", "json"], jsonReporter: { fileName: "reports/mutation/product-form.json" },
  concurrency: 2, coverageAnalysis: "perTest", thresholds: { high: 100, low: 95, break: 95 } };
export default config;
