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
    "src/core/route-request-cache.ts",
    "src/core/route-logistics-search.ts",
    "src/core/route-incidents.ts",
    "src/core/route-ai-planner.ts:252-267",
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.route-logistics.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/route-logistics.html" },
  jsonReporter: { fileName: "reports/mutation/route-logistics.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 95, break: 95 },
};

export default config;
