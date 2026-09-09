import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/picker-notes.test.ts"], fileParallelism: false },
});
