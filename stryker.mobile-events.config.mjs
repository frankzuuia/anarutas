import baseConfig from "./stryker.base.config.mjs";

const mobileEventsMutationConfig = {
  ...baseConfig,
  ignorePatterns: [...baseConfig.ignorePatterns, "driver-app/**"],
  mutate: [
    "src/core/driver-mobile-events.ts:11-16",
    "src/core/driver-mobile-events.ts:65-72",
    "src/core/driver-mobile-events.ts:109-109",
  ],
  testFiles: ["tests/driver-mobile.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/mobile-events.html" },
  jsonReporter: { fileName: "reports/mutation/mobile-events.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 90, low: 80, break: 80 },
};

export default mobileEventsMutationConfig;
