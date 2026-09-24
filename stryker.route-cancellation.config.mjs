import baseConfig from "./stryker.base.config.mjs";

const routeCancellationConfig = {
  ...baseConfig,
  mutate: ["src/core/route-publications.ts:240-253"],
  testFiles: ["tests/route-publications.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/route-cancellation.json" },
  concurrency: 2,
  timeoutMS: 60000,
  // PostgreSQL scenarios share lifecycle state: selective execution is not valid here.
  coverageAnalysis: "off",
  thresholds: { high: 90, low: 80, break: 80 },
};

export default routeCancellationConfig;
