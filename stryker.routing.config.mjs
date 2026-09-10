const config = {
  ignorePatterns: [
    ".local/**",
    "reports/**",
    "test-results/**",
    "coverage/**",
    ".next/**",
  ],
  mutate: [
    "src/core/route-optimization-google.ts:70-395",
    "src/core/routing-validation.ts",
    "src/core/geocode-quality.ts",
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.routing-unit.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/routing.html" },
  jsonReporter: { fileName: "reports/mutation/routing.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 100, break: 100 },
};

export default config;
