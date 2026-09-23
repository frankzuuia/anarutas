import baseConfig from "./stryker.base.config.mjs";

const unitPhotosConfig = {
  ...baseConfig,
  mutate: ["src/core/unit-photos.ts:146-176"],
  testFiles: ["tests/route-publications.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/unit-photos.json" },
  concurrency: 1,
  coverageAnalysis: "perTest",
  thresholds: { high: 90, low: 80, break: 80 },
};

export default unitPhotosConfig;
