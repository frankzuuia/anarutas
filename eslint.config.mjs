import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".local/**",
    "coverage/**",
    "reports/**",
    "test-results/**",
    "playwright-report/**",
    ".stryker-tmp/**",
    "next-env.d.ts",
  ]),
]);
