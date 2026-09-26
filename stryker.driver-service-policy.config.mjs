import baseConfig from "./stryker.base.config.mjs";
const config = {
  ...baseConfig,
  mutate: ["src/core/driver-service-policy.ts"],
  testFiles: ["tests/driver-service-policy.test.ts"],
  testRunner: "vitest", vitest: { configFile: "vitest.config.ts" },
  reporters: ["progress", "clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/driver-service-policy.json" },
  concurrency: 2, timeoutMS: 60000, coverageAnalysis: "perTest",
  thresholds: { high: 95, low: 90, break: 90 },
};
export default config;
