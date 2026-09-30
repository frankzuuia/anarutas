import baseConfig from "./stryker.base.config.mjs";
const config = {
  ...baseConfig,
  mutate: ["src/core/driver-route-completion-policy.ts"],
  testRunner: "vitest", vitest: { configFile: "vitest.route-completion.config.ts" },
  reporters: ["progress", "clear-text", "json"], jsonReporter: { fileName: "reports/mutation/route-completion.json" },
  concurrency: 2, timeoutMS: 60000, coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 100, break: 100 },
};
export default config;
