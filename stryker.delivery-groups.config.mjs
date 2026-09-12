const config = {
  ignorePatterns: [
    ".local/**",
    "reports/**",
    "test-results/**",
    "coverage/**",
    ".next/**",
  ],
  mutate: [
    "src/core/route-delivery-groups.ts",
    "src/core/route-fingerprint.ts",
    "src/core/route-ai-planner.ts:60-185",
    "src/core/route-ai-planner.ts:206-250",
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.delivery-groups.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/delivery-groups.html" },
  jsonReporter: { fileName: "reports/mutation/delivery-groups.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 95, low: 90, break: 90 },
};

export default config;
