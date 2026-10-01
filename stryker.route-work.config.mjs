import base from "./stryker.base.config.mjs";
const config = {
  ...base,
  mutate: ["src/core/route-work-policy.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.route-work-policy.config.ts" },
  reporters: ["progress", "clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/route-work.html" },
  jsonReporter: { fileName: "reports/mutation/route-work.json" },
  concurrency: 4,
  coverageAnalysis: "off",
  thresholds: { high: 95, low: 90, break: 90 },
};
export default config;
