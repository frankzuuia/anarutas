import base from "./stryker.base.config.mjs";
const config = { ...base, mutate: ["src/core/live-eta.ts", "src/core/live-eta-validation.ts"], testFiles: ["tests/live-eta.test.ts"],
  testRunner: "vitest", vitest: { configFile: "vitest.config.ts" }, coverageAnalysis: "perTest",
  reporters: ["progress", "clear-text", "json"], jsonReporter: { fileName: "reports/mutation/live-eta.json" },
  concurrency: 2, thresholds: { high: 100, low: 100, break: 100 } };
export default config;
