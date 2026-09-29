import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/product-incident-form.test.ts"], fileParallelism: false } });
