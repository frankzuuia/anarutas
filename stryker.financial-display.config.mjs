import base from "./stryker.base.config.mjs";
const config = {
  ...base,
  mutate: [
    "src/core/financial-display.ts",
    "src/core/incident-financial-display.ts",
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.financial-display.config.ts" },
  reporters: ["progress", "clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/financial-display.html" },
  jsonReporter: { fileName: "reports/mutation/financial-display.json" },
  concurrency: 4,
  coverageAnalysis: "off",
  thresholds: { high: 95, low: 90, break: 90 },
};
export default config;
