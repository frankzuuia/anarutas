import baseConfig from "./stryker.base.config.mjs";

const driverDashboardMutationConfig = {
  ...baseConfig,
  ignorePatterns: [...baseConfig.ignorePatterns, "driver-app/**"],
  mutate: [
    "src/core/driver-mobile-route.ts:28-41",
    "src/core/driver-mobile-route.ts:112-120",
  ],
  testFiles: ["tests/driver-mobile.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/driver-dashboard.html" },
  jsonReporter: { fileName: "reports/mutation/driver-dashboard.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 90, low: 80, break: 80 },
};

export default driverDashboardMutationConfig;
