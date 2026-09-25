import baseConfig from "./stryker.base.config.mjs";

const driverAddressConfig = {
  ...baseConfig,
  mutate: ["src/core/driver-execution-policy.ts:43-60"],
  testFiles: ["tests/driver-execution-policy.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/driver-address.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 95, low: 90, break: 90 },
};

export default driverAddressConfig;
