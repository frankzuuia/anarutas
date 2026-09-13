const config = {
  ignorePatterns: [
    ".local/**",
    "reports/**",
    "test-results/**",
    "coverage/**",
    ".next/**",
  ],
  mutate: [
    "src/core/route-road.ts:29-109",
    "src/core/route-road.ts:153-181",
    "src/core/route-candidate-evaluator.ts:34-184",
    "src/core/route-deterministic-planner.ts:98-443",
    "src/core/route-fingerprint.ts",
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.routing-operations-unit.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/routing-operations.html" },
  jsonReporter: { fileName: "reports/mutation/routing-operations.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 90, low: 80, break: 80 },
};

export default config;
