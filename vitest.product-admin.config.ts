import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/product-incident-admin-cancel.test.ts"], fileParallelism: false } });
