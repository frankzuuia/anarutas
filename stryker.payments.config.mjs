import base from "./stryker.base.config.mjs";
const config={...base,mutate:["src/core/payment-policy.ts","src/core/account-role.ts"],testRunner:"vitest",vitest:{configFile:"vitest.payments.config.ts"},reporters:["progress","clear-text","html","json"],htmlReporter:{fileName:"reports/mutation/payments.html"},jsonReporter:{fileName:"reports/mutation/payments.json"},concurrency:3,coverageAnalysis:"off",thresholds:{high:95,low:90,break:90}};
export default config;
