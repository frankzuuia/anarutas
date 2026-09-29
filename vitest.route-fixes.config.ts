import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/route-publication-revisions.test.ts", "tests/product-thumbnails.test.ts"], fileParallelism: false } });
