import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/incident-alarm-lifecycle.test.ts"] },
});
