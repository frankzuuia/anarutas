import baseConfig from "./stryker.base.config.mjs";

const config = {
  ...baseConfig,
  mutate: ["src/core/driver-order-retry.ts:26-42"],
  testFiles: ["tests/driver-service-commands.test.ts"],
  testRunner: "vitest", vitest: { configFile: "vitest.config.ts" },
  reporters: ["progress", "clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/driver-retry.json" },
  concurrency: 2, timeoutMS: 60000, coverageAnalysis: "perTest",
  thresholds: { high: 95, low: 85, break: 95 },
};
export default config;
