const config = {
  ignorePatterns: [
    ".local/**",
    "reports/**",
    "test-results/**",
    "coverage/**",
    ".next/**",
  ],
  mutate: [
    "src/core/customers-validation.ts:36-75",
    "src/core/odoo-partner-capabilities.ts:23-36",
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.customers-mutation.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/customers.html" },
  jsonReporter: { fileName: "reports/mutation/customers.json" },
  concurrency: 2,
  coverageAnalysis: "off",
  thresholds: { high: 100, low: 100, break: 100 },
};

export default config;
