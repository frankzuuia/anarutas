import baseConfig from "./stryker.base.config.mjs";

const unitPhotoDeletionConfig = {
  ...baseConfig,
  mutate: ["src/core/unit-photos.ts:247-278"],
  testFiles: ["tests/route-publications.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/unit-photo-deletion.json" },
  concurrency: 1,
  coverageAnalysis: "perTest",
  thresholds: { high: 90, low: 80, break: 80 },
};

export default unitPhotoDeletionConfig;
