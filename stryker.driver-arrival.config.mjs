import baseConfig from "./stryker.base.config.mjs";

const driverArrivalConfig = {
  ...baseConfig,
  mutate: ["src/core/driver-execution-policy.ts"],
  testFiles: ["tests/driver-execution-policy.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/driver-arrival.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 95, low: 90, break: 90 },
};

export default driverArrivalConfig;
