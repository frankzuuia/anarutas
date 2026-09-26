import baseConfig from "./stryker.base.config.mjs";

const driverServiceMutationConfig = {
  ...baseConfig,
  // Focused mutations for repeated arrivals, prior-visit exit, authorization,
  // optimistic version and idempotency. SQL migration is exercised by a real
  // PostgreSQL upgrade/rollback fixture, not a replaced database.
  mutate: [
    "src/core/driver-stop-command.ts:119-121",
    "src/core/driver-stop-command.ts:135-142",
    "src/core/driver-stop-command.ts:198-211",
  ],
  testFiles: ["tests/driver-service-schema.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["progress", "clear-text", "json"],
  jsonReporter: { fileName: "reports/mutation/driver-service.json" },
  concurrency: 2,
  timeoutMS: 60000,
  coverageAnalysis: "perTest",
  thresholds: { high: 95, low: 85, break: 85 },
};

export default driverServiceMutationConfig;
