import baseConfig from "./stryker.base.config.mjs";
const config = { ...baseConfig, mutate: ["src/core/live-warehouse-policy.ts", "src/core/live-route-destination.ts", "src/core/live-eta-validation.ts", "src/core/live-eta.ts"],
  testRunner: "vitest", vitest: { configFile: "vitest.live-warehouse.config.ts" },
  reporters: ["progress", "clear-text", "json"], jsonReporter: { fileName: "reports/mutation/live-warehouse.json" },
  concurrency: 2, timeoutMS: 60000, coverageAnalysis: "perTest", thresholds: { high: 100, low: 100, break: 100 } };
export default config;
