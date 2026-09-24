import baseConfig from "./stryker.base.config.mjs";

const routePushMutationConfig = {
  ...baseConfig,
  ignorePatterns: [...baseConfig.ignorePatterns, "driver-app/**"],
  mutate: [
    "src/core/route-push.ts:19-60",
    "src/core/route-push-registration.ts:6-10",
  ],
  testFiles: ["tests/route-push.test.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/route-push.html" },
  jsonReporter: { fileName: "reports/mutation/route-push.json" },
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 90, low: 80, break: 80 },
};

export default routePushMutationConfig;
