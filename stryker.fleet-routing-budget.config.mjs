import baseConfig from "./stryker.base.config.mjs";

const config = {
  ...baseConfig,
  mutate: ["src/core/route-fleet-budget.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.routing-unit.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/fleet-routing-budget.html" },
  jsonReporter: { fileName: "reports/mutation/fleet-routing-budget.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 100, break: 100 },
};

export default config;
