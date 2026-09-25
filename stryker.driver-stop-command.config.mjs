import baseConfig from "./stryker.base.config.mjs";

const driverStopCommandConfig = {
  ...baseConfig,
  // Explicit critical guards, idempotency and incident classification. SQL writes are
  // checked by real rollback/isolation tests; this score is not full-module mutation.
  mutate: [
    "src/core/driver-stop-command.ts:28-30",
    "src/core/driver-stop-command.ts:52-56",
    "src/core/driver-stop-command.ts:85-92",
    "src/core/driver-stop-command.ts:95-107",
    "src/core/driver-stop-command.ts:128-128",
  ],
  testFiles: ["tests/driver-execution.test.ts", "tests/driver-execution-concurrency.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["progress", "clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/driver-stop-command.json" },
  concurrency: 2,
  timeoutMS: 60000,
  coverageAnalysis: "perTest",
  thresholds: { high: 95, low: 90, break: 90 },
};

export default driverStopCommandConfig;
