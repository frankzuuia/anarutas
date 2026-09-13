import logistics from "./stryker.route-logistics.config.mjs";

const config = {
  ...logistics,
  mutate: ["src/core/route-incidents-query.ts"],
  vitest: { configFile: "vitest.route-incidents-query.config.ts" },
  htmlReporter: { fileName: "reports/mutation/route-incidents-query.html" },
  jsonReporter: { fileName: "reports/mutation/route-incidents-query.json" },
  concurrency: 1,
  thresholds: { high: 100, low: 100, break: 100 },
};

export default config;
