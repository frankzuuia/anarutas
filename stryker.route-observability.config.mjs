import baseConfig from "./stryker.base.config.mjs";

const config = {
  ...baseConfig,
  mutate: ["src/core/route-observability.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.route-observability.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/route-observability.html" },
  jsonReporter: { fileName: "reports/mutation/route-observability.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 100, break: 100 },
};

export default config;
