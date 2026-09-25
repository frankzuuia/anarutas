import baseConfig from "./stryker.base.config.mjs";

const manualRoutePreviewConfig = {
  ...baseConfig,
  mutate: ["src/core/manual-route-preview.ts"],
  testFiles: ["tests/manual-route-preview.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/manual-route-preview.json" },
  concurrency: 1,
  coverageAnalysis: "perTest",
  thresholds: { high: 90, low: 80, break: 80 },
};

export default manualRoutePreviewConfig;
