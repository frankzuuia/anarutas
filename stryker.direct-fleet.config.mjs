const config = {
  ignorePatterns: [
    ".local/**",
    "reports/**",
    "test-results/**",
    "coverage/**",
    ".next/**",
  ],
  mutate: ["src/core/route-google-direct.ts", "src/core/route-fleet-budget.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.direct-fleet.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/direct-fleet.html" },
  jsonReporter: { fileName: "reports/mutation/direct-fleet.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 95, low: 90, break: 90 },
};

export default config;
