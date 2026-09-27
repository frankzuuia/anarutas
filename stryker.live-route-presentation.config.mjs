import base from "./stryker.base.config.mjs";
const config = { ...base, mutate: ["src/core/live-route-presentation.ts"], testFiles: ["tests/live-route-presentation.test.ts"],
  testRunner: "vitest", vitest: { configFile: "vitest.config.ts" }, coverageAnalysis: "perTest",
  reporters: ["progress", "clear-text", "json"], jsonReporter: { fileName: "reports/mutation/live-route-presentation.json" },
  concurrency: 2, thresholds: { high: 100, low: 100, break: 100 } };
export default config;
