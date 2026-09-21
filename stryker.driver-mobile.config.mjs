import baseConfig from "./stryker.base.config.mjs";

const driverMobileMutationConfig = {
  ...baseConfig,
  ignorePatterns: [...baseConfig.ignorePatterns, "driver-app/**"],
  mutate: [
    "src/core/driver-mobile-auth.ts:19-50",
    "src/core/driver-mobile-route.ts:10-27",
  ],
  testFiles: ["tests/driver-mobile.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/driver-mobile.html" },
  jsonReporter: { fileName: "reports/mutation/driver-mobile.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 90, low: 80, break: 80 },
};

export default driverMobileMutationConfig;
