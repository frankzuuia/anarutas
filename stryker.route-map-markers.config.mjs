import baseConfig from "./stryker.base.config.mjs";

const routeMapMarkersConfig = {
  ...baseConfig,
  mutate: ["src/core/route-map-markers.ts:38-51"],
  testFiles: ["tests/route-map-markers.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/route-map-markers.json" },
  concurrency: 1,
  coverageAnalysis: "perTest",
  thresholds: { high: 90, low: 80, break: 80 },
};

export default routeMapMarkersConfig;
