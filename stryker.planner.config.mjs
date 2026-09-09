const config = {
  ignorePatterns: [
    ".local/**",
    "reports/**",
    "test-results/**",
    "coverage/**",
    ".next/**",
  ],
  mutate: ["src/core/picker-notes.ts", "src/core/map-config.ts"],
  testRunner: "vitest",
  vitest: { configFile: "vitest.planner.config.ts" },
  reporters: ["clear-text", "html", "json"],
  concurrency: 2,
  coverageAnalysis: "perTest",
  thresholds: { high: 100, low: 100, break: 100 },
};
export default config;
