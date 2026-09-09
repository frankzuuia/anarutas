const config = {
  mutate: ["src/core/policy.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.unit.config.ts" },
  reporters: ["clear-text", "html", "json"],
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 100, break: 100 },
};
export default config;
