const config = {
  ignorePatterns: [
    ".local/**",
    "reports/**",
    "test-results/**",
    "coverage/**",
    ".next/**",
  ],
  mutate: [
    "src/core/route-logistics-policy.ts",
    "src/core/route-geographic-planner.ts",
    "src/core/route-candidate-evaluator.ts:34-184",
    "src/core/route-optimization-google.ts:137-391",
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.route-logistics.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/route-logistics.html" },
  jsonReporter: { fileName: "reports/mutation/route-logistics.json" },
  concurrency: 6,
  coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 95, break: 95 },
};

export default config;
