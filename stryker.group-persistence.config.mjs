import groups from "./stryker.delivery-groups.config.mjs";

const config = {
  ...groups,
  mutate: ["src/core/route-optimization.ts:183-189"],
  vitest: { configFile: "vitest.group-persistence.config.ts" },
  jsonReporter: { fileName: "reports/mutation/group-persistence.json" },
  htmlReporter: { fileName: "reports/mutation/group-persistence.html" },
  thresholds: { high: 100, low: 100, break: 100 },
};

export default config;
