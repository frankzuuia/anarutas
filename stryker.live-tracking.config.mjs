import base from "./stryker.base.config.mjs";
const config = { ...base, mutate: ["src/core/live-tracking-policy.ts"], testFiles: ["tests/live-tracking.test.ts"],
  testRunner: "vitest", vitest: { configFile: "vitest.config.ts" }, coverageAnalysis: "perTest",
  reporters: ["progress", "clear-text", "json"], jsonReporter: { fileName: "reports/mutation/live-tracking.json" },
  concurrency: 2, timeoutMS: 60000, thresholds: { high: 95, low: 90, break: 90 } };
export default config;
