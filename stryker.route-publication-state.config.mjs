import baseConfig from "./stryker.base.config.mjs";

const routePublicationStateConfig = {
  ...baseConfig,
  mutate: [
    "src/core/route-publication-content.ts:51-67",
    "src/core/route-publications.ts:41-48",
    "src/core/route-publications.ts:169-174",
  ],
  testFiles: ["tests/route-publication-content.test.ts", "tests/route-publications.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/route-publication-state.json" },
  concurrency: 2,
  timeoutMS: 60000,
  // PostgreSQL scenarios share lifecycle state: each mutant must run the entire suite.
  coverageAnalysis: "off",
  thresholds: { high: 90, low: 80, break: 80 },
};

export default routePublicationStateConfig;
