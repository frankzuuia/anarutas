const config = {
  mutate: ["src/core/fleet-validation.ts", "src/server/document-body.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.fleet-unit.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/fleet.html" },
  jsonReporter: { fileName: "reports/mutation/fleet.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 100, break: 100 },
};

export default config;
