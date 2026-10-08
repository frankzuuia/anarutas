import baseConfig from "./stryker.base.config.mjs";
const config = {
  ...baseConfig,
  mutate: ["src/core/odoo-archived-orders.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.odoo-archived-orders.config.ts" },
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/odoo-archived-orders.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 100, break: 100 },
};
export default config;
