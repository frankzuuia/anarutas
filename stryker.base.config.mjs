// Shared Stryker storage hygiene: always remove sandbox temp dirs (including
// interrupted or failed runs) and keep generated directories out of mutation.
const baseConfig = {
  cleanTempDir: "always",
  ignorePatterns: [
    ".local/**",
    ".next/**",
    "coverage/**",
    "reports/**",
    "test-results/**",
    "playwright-report/**",
    "driver-app/app/build/**",
    "driver-app/.gradle/**",
  ],
};

export default baseConfig;
