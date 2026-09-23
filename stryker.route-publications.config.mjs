import baseConfig from "./stryker.base.config.mjs";

const routePublicationsConfig = {
  ...baseConfig,
  mutate: ["src/core/route-publications.ts:114-139"],
  testFiles: ["tests/route-publications.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/route-publications.json" },
  concurrency: 1,
  coverageAnalysis: "perTest",
  thresholds: { high: 90, low: 80, break: 80 },
};

export default routePublicationsConfig;
