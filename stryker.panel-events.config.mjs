import baseConfig from "./stryker.base.config.mjs";

const panelEventsConfig = {
  ...baseConfig,
  mutate: [
    "src/core/panel-event-stream.ts:45-59",
    "src/core/panel-event-stream.ts:83-94",
    "src/core/panel-events.ts:22-30",
  ],
  testFiles: ["tests/panel-events.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/panel-events.json" },
  concurrency: 1,
  coverageAnalysis: "perTest",
  thresholds: { high: 90, low: 80, break: 80 },
};
export default panelEventsConfig;
