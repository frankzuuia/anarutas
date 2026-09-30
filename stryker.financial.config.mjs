import baseConfig from "./stryker.base.config.mjs";
const config = {
  ...baseConfig,
  mutate: [
    "src/core/financial-policy.ts",
    "src/core/financial-values.ts",
    "src/core/financial-config.ts",
    "src/core/odoo-financial-contract.ts",
    "src/core/odoo-retry.ts",
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.financial-policy.config.ts" },
  reporters: ["progress", "clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/financial.html" },
  jsonReporter: { fileName: "reports/mutation/financial.json" },
  concurrency: 4,
  coverageAnalysis: "off",
  thresholds: { high: 95, low: 90, break: 90 },
};
export default config;
