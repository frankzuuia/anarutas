import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { startPostgres } from "./helpers/postgres";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("temporary PostgreSQL lifecycle", () => {
  it("removes only its own database directory when closed", async () => {
    const localRoot = resolve(".local");
    await mkdir(localRoot, { recursive: true });
    const preservedDirectory = await mkdtemp(
      resolve(localRoot, "postgres-lifecycle-preserved-"),
    );
    const database = await startPostgres();

    try {
      expect(database.databaseDir.startsWith(resolve(localRoot, "pg-"))).toBe(
        true,
      );
      expect(await exists(database.databaseDir)).toBe(true);

      await database.close();
      await database.close();

      expect(await exists(database.databaseDir)).toBe(false);
      expect(await exists(preservedDirectory)).toBe(true);
    } finally {
      await database.close().catch(() => undefined);
      await rm(preservedDirectory, { recursive: true, force: true });
    }
  });
});
