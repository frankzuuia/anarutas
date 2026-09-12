const config = {
  ignorePatterns: [
    ".local/**",
    "reports/**",
    "test-results/**",
    "coverage/**",
    ".next/**",
  ],
  mutate: [
    "src/core/order-candidates-validation.ts",
    "src/core/order-candidates.ts:211-230",
    "src/core/order-candidates.ts:271-310",
    "src/core/order-candidates.ts:354-367",
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.order-candidates.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/order-candidates.html" },
  jsonReporter: { fileName: "reports/mutation/order-candidates.json" },
  concurrency: 4,
  coverageAnalysis: "perTest",
  thresholds: { high: 95, low: 90, break: 90 },
};

export default config;
