import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/live-warehouse.test.ts", "tests/live-eta.test.ts"] } });
