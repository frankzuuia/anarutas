import baseConfig from "./stryker.base.config.mjs";

const panelEventsConfig = {
  ...baseConfig,
  mutate: [
    "src/core/panel-event-stream.ts:7-9",
    "src/core/panel-event-stream.ts:49-63",
    "src/core/panel-event-stream.ts:87-97",
    "src/core/panel-events.ts:22-30",
  ],
  testFiles: ["tests/panel-events.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/panel-events.json" },
  concurrency: 1,
  coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 100, break: 100 },
};
export default panelEventsConfig;
