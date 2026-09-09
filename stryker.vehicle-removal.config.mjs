const config = {
  ignorePatterns: [
    ".local/**",
    "reports/**",
    "test-results/**",
    "coverage/**",
    ".next/**",
  ],
  mutate: ["src/core/orders.ts:151-182"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.vehicle-removal.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/vehicle-removal.html" },
  jsonReporter: { fileName: "reports/mutation/vehicle-removal.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 100, break: 100 },
};

export default config;
