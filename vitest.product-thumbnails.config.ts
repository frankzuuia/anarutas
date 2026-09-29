import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/product-thumbnails.test.ts"], fileParallelism: false } });
