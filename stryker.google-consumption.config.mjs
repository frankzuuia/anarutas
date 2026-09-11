const config = {
  ignorePatterns: [
    ".local/**",
    "reports/**",
    "test-results/**",
    "coverage/**",
    ".next/**",
  ],
  mutate: [
    "src/core/google-consumption-config.ts",
    "src/core/google-consumption-bigquery.ts:435-588",
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.google-consumption-mutation.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/google-consumption.html" },
  jsonReporter: { fileName: "reports/mutation/google-consumption.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 95, low: 90, break: 90 },
};

export default config;
