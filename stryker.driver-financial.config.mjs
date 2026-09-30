import base from "./stryker.base.config.mjs";
const config = {
  ...base,
  mutate: [
    "src/core/driver-financial-policy.ts",
    "src/core/financial-allocation.ts",
    "src/core/incident-financial-input.ts",
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.driver-financial.config.ts" },
  reporters: ["progress", "clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/driver-financial.html" },
  jsonReporter: { fileName: "reports/mutation/driver-financial.json" },
  concurrency: 4,
  coverageAnalysis: "off",
  thresholds: { high: 95, low: 90, break: 90 },
};
export default config;
