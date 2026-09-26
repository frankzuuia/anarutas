import baseConfig from "./stryker.base.config.mjs";

const config = {
  ...baseConfig,
  mutate: ["src/core/driver-service-context.ts:24-25", "src/core/driver-service-context.ts:32-36"],
  testFiles: ["tests/driver-service-commands.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["progress", "clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/driver-service-context.json" },
  concurrency: 2,
  timeoutMS: 60000,
  coverageAnalysis: "perTest",
  thresholds: { high: 95, low: 90, break: 90 },
};
export default config;
