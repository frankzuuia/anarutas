import baseConfig from "./stryker.base.config.mjs";

const routeMapSelectionConfig = {
  ...baseConfig,
  mutate: ["src/core/route-map-selection.ts"],
  testFiles: ["tests/route-map-selection.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/route-map-selection.json" },
  concurrency: 1,
  coverageAnalysis: "perTest",
  thresholds: { high: 95, low: 90, break: 90 },
};

export default routeMapSelectionConfig;
