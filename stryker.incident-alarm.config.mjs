import baseConfig from "./stryker.base.config.mjs";
const config = {
  ...baseConfig,
  mutate: ["src/core/incident-board-policy.ts:36-56"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.incident-alarm.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/incident-alarm.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 100, break: 100 },
};
export default config;
