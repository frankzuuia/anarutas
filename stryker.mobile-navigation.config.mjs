import baseConfig from "./stryker.base.config.mjs";
const config = {
  ...baseConfig,
  mutate: [
    "src/components/navigation-hit-test.ts",
    "src/components/navigation-focus.ts",
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.mobile-navigation.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/mobile-navigation.json" },
  concurrency: 1,
  coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 100, break: 100 },
};
export default config;
