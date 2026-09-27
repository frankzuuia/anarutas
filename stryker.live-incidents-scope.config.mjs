import baseConfig from "./stryker.base.config.mjs";

const config = {
  ...baseConfig,
  mutate: [
    "src/core/driver-incidents.ts:29-33",
    // Null type guards in the range-order check have equivalent JS relational mutants.
    "src/core/driver-incidents.ts:35-36",
    "src/core/driver-live-incidents.ts:23-35",
    "src/core/driver-live-incidents.ts:40-40",
  ],
  testFiles: ["tests/driver-execution-policy.test.ts", "tests/driver-service-commands.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["progress", "clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/live-incidents-scope.json" },
  concurrency: 2,
  timeoutMS: 60000,
  coverageAnalysis: "perTest",
  thresholds: { high: 95, low: 85, break: 85 },
};

export default config;
