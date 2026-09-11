const config = {
  ignorePatterns: [
    ".local/**",
    "reports/**",
    "test-results/**",
    "coverage/**",
    ".next/**",
  ],
  mutate: [
    "src/core/openai-routing-config.ts",
    "src/core/route-road.ts:29-109",
    "src/core/route-road.ts:153-181",
    "src/core/route-ai-planner.ts:59-180",
    "src/core/route-ai-planner.ts:203-225",
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
