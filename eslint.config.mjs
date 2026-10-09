import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "src/core/odoo-return*.ts",
      "src/core/odoo-returns.ts",
      "src/server/odoo-return-worker.ts",
    ],
    rules: { complexity: ["error", 20] },
  },
  globalIgnores([
    ".next/**",
    ".local/**",
    "coverage/**",
    "reports/**",
    "test-results/**",
    "playwright-report/**",
    ".stryker-tmp/**",
    "driver-app/app/build/**",
    "driver-app/.kotlin/**",
    "next-env.d.ts",
  ]),
]);
