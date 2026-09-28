import baseConfig from "./stryker.base.config.mjs";

const config = {
  ...baseConfig,
  mutate: ["src/core/customer-windows-daily-schema.ts"],
  testFiles: ["tests/customer-windows-daily.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/customer-windows-daily.json" },
  concurrency: 2,
  timeoutMS: 120000,
  coverageAnalysis: "off",
  thresholds: { high: 100, low: 100, break: 100 },
};

export default config;
