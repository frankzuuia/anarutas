import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { startPostgres } from "./helpers/postgres";
import {
  assertInstallation,
  audit,
  createPool,
  migrate,
  transaction,
} from "../src/core/database";
import {
  authenticate,
  bootstrap,
  createUser,
  login,
  logout,
  setUserActive,
  throttle,
  textField,
  passwordField,
} from "../src/core/auth";
import {
  hashPassword,
  secretMatches,
  tokenHash,
  verifyPassword,
} from "../src/core/crypto";
import { createPlan, editPlan, listPlans } from "../src/core/plans";
let db: Awaited<ReturnType<typeof startPostgres>>;
let actor: string;
let token: string;
const password = "Contraseña larga para QA " + randomUUID();
beforeAll(async () => {
  db = await startPostgres();
});
afterAll(async () => {
  await db?.close();
});
describe("PostgreSQL real / auth / persistence", () => {
  it("serializes migration and refuses a different installation", async () => {
    await Promise.all([
      migrate(db.pool, db.config.instanceId),
      migrate(db.pool, db.config.instanceId),
    ]);
    await expect(migrate(db.pool, "different")).rejects.toThrow(
      "INSTALLATION_MISMATCH",
    );
    await assertInstallation(db.pool, db.config.instanceId);
  });
  it("denies wrong setup key without creating a user", async () => {
    await expect(
      bootstrap(db.pool, db.config, { token: "bad" }),
    ).rejects.toThrow("SETUP_DENIED");
    expect(
      (await db.pool.query("SELECT count(*)::int AS n FROM route_users"))
        .rows[0].n,
    ).toBe(0);
  });
  it("allows only one concurrent bootstrap and no registration afterwards", async () => {
    const input = {
      token: db.config.bootstrapToken,
      name: "QA Administrator",
      login: "qa-admin",
      password,
    };
    const results = await Promise.allSettled([
      bootstrap(db.pool, db.config, input),
      bootstrap(db.pool, db.config, input),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    actor = (await db.pool.query("SELECT id FROM route_users")).rows[0].id;
    await expect(bootstrap(db.pool, db.config, input)).rejects.toThrow(
      "SETUP_DENIED",
    );
  });
  it("hashes passwords with random salts; verifies invalid/missing encodings", async () => {
    const a = await hashPassword(password),
      b = await hashPassword(password);
    expect(a).not.toBe(b);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword("incorrect", a)).toBe(false);
    expect(await verifyPassword(password, null)).toBe(false);
    expect(await verifyPassword(password, "corrupt")).toBe(false);
    expect(await verifyPassword("x".repeat(129), a)).toBe(false);
    await expect(hashPassword("short")).rejects.toThrow("PASSWORD_POLICY");
    const sixCharacters = randomUUID().slice(0, 6);
    const shortHash = await hashPassword(sixCharacters);
    expect(await verifyPassword(sixCharacters, shortHash)).toBe(true);
    expect(await verifyPassword(sixCharacters.slice(0, 5), shortHash)).toBe(
      false,
    );
    expect(secretMatches("x", "")).toBe(false);
    expect(
      secretMatches(db.config.bootstrapToken, db.config.bootstrapToken),
    ).toBe(true);
  });
  it("rejects unknown or incorrect accounts, sessions are not plaintext", async () => {
    await expect(
      login(db.pool, db.config, { login: "does-not-exist", password }),
    ).rejects.toThrow("LOGIN_INVALID");
    await expect(
      login(db.pool, db.config, { login: "qa-admin", password: "wrong" }),
    ).rejects.toThrow("LOGIN_INVALID");
    const result = await login(db.pool, db.config, {
      login: " QA-ADMIN ",
      password,
    });
    token = result.token;
    expect(result.user.id).toBe(actor);
    expect(
      (await db.pool.query("SELECT token_hash FROM route_sessions")).rows.some(
        (row) => row.token_hash === token,
      ),
    ).toBe(false);
    expect((await authenticate(db.pool, db.config, token)).id).toBe(actor);
  });
  it("sessions coexist and logout only revokes its own", async () => {
    const other = await login(db.pool, db.config, {
      login: "qa-admin",
      password,
    });
    await logout(db.pool, actor, other.token);
    await expect(authenticate(db.pool, db.config, other.token)).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    await authenticate(db.pool, db.config, token);
    for (const invalid of [undefined, "wrong", "x".repeat(64)])
      await expect(authenticate(db.pool, db.config, invalid)).rejects.toThrow(
        "UNAUTHENTICATED",
      );
  });
  it("rejects idle/absolute expiry then permits valid session after server reconnect", async () => {
    await db.pool.query(
      "UPDATE route_sessions SET idle_expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [tokenHash(token)],
    );
    await expect(authenticate(db.pool, db.config, token)).rejects.toThrow();
    await db.pool.query(
      "UPDATE route_sessions SET idle_expires_at=now()+interval '1 minute',expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [tokenHash(token)],
    );
    await expect(authenticate(db.pool, db.config, token)).rejects.toThrow();
    await db.pool.query(
      "UPDATE route_sessions SET expires_at=now()+interval '1 hour' WHERE token_hash=$1",
      [tokenHash(token)],
    );
    await authenticate(db.pool, db.config, token);
  });
  it("creates accounts and revokes access on deactivation", async () => {
    const user = await createUser(db.pool, actor, {
      name: "QA Second",
      login: "qa-second",
      password,
    });
    const session = await login(db.pool, db.config, {
      login: "qa-second",
      password,
    });
    await expect(
      createUser(db.pool, actor, {
        name: "Duplicate",
        login: "QA-SECOND",
        password,
      }),
    ).rejects.toThrow();
    await setUserActive(db.pool, actor, user.id, false);
    await expect(
      authenticate(db.pool, db.config, session.token),
    ).rejects.toThrow();
    await expect(
      login(db.pool, db.config, { login: "qa-second", password }),
    ).rejects.toThrow("LOGIN_INVALID");
    await setUserActive(db.pool, actor, user.id, true);
    await expect(
      authenticate(db.pool, db.config, session.token),
    ).rejects.toThrow();
    await expect(setUserActive(db.pool, actor, actor, false)).rejects.toThrow(
      "SELF_DEACTIVATION",
    );
    await expect(
      setUserActive(db.pool, actor, user.id, "false"),
    ).rejects.toThrow("INVALID_INPUT");
    await expect(
      setUserActive(db.pool, actor, randomUUID(), false),
    ).rejects.toThrow("NOT_FOUND");
  });
  it("persists throttle limits including exact boundary and expiry reset", async () => {
    const key = randomUUID();
    await throttle(db.pool, key, 2);
    await throttle(db.pool, key, 2);
    await expect(throttle(db.pool, key, 2)).rejects.toThrow(
      "TOO_MANY_ATTEMPTS",
    );
    await db.pool.query(
      "UPDATE auth_attempts SET expires_at=now()-interval '1 second' WHERE key=$1",
      [key],
    );
    await throttle(db.pool, key, 2);
  });
  it("rolls back mutations atomically", async () => {
    const key = randomUUID();
    await expect(
      transaction(db.pool, async (client) => {
        await audit(client, actor, "test.rollback", key);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(
      (
        await db.pool.query("SELECT id FROM route_audit WHERE entity_id=$1", [
          key,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("creates one shared plan on concurrent retries", async () => {
    const input = { date: "2026-10-08", label: "QA plan" };
    const [one, two] = await Promise.all([
      createPlan(db.pool, actor, input),
      createPlan(db.pool, actor, input),
    ]);
    expect(one.id).toBe(two.id);
    expect(await listPlans(db.pool)).toHaveLength(1);
    expect(
      (
        await db.pool.query(
          "SELECT id FROM route_audit WHERE action='plan.created'",
        )
      ).rowCount,
    ).toBe(1);
  });
  it("rejects stale updates without losing accepted version", async () => {
    const [plan] = await listPlans(db.pool);
    const results = await Promise.allSettled([
      editPlan(db.pool, actor, plan.id, { expectedVersion: 1, label: "First" }),
      editPlan(db.pool, actor, plan.id, {
        expectedVersion: 1,
        label: "Second",
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect((await listPlans(db.pool))[0].version).toBe(2);
    await expect(
      editPlan(db.pool, actor, randomUUID(), {
        expectedVersion: 1,
        label: "Not found",
      }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      editPlan(db.pool, actor, plan.id, {
        expectedVersion: "2",
        label: "Invalid",
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
  });
  it("validates transport types without parsing intentions", () => {
    for (const input of [null, {}, 5, ""])
      expect(() => textField(input)).toThrow();
    expect(textField(" hello ")).toBe("hello");
    expect(() => passwordField(5)).toThrow();
    expect(() => passwordField("x".repeat(129))).toThrow();
  });
  it("refuses a nonempty unrelated database including another schema", async () => {
    await db.server.createDatabase("qa_unrelated");
    const connection = new URL(db.config.databaseUrl);
    connection.pathname = "/qa_unrelated";
    const unrelated = createPool(connection.href);
    try {
      await unrelated.query(
        "CREATE SCHEMA other_app; CREATE TABLE other_app.protected_row(id integer); INSERT INTO other_app.protected_row VALUES(7)",
      );
      await expect(migrate(unrelated, randomUUID())).rejects.toThrow(
        "DATABASE_NOT_DEDICATED",
      );
      expect(
        (await unrelated.query("SELECT id FROM other_app.protected_row")).rows,
      ).toEqual([{ id: 7 }]);
      expect(
        (
          await unrelated.query(
            "SELECT tablename FROM pg_tables WHERE schemaname='public'",
          )
        ).rows,
      ).toEqual([]);
    } finally {
      await unrelated.end();
    }
  });
  it("refuses incompatible schema versions without silently upgrading", async () => {
    await db.pool.query("UPDATE rutas_installation SET schema_version=999");
    await expect(migrate(db.pool, db.config.instanceId)).rejects.toThrow(
      "SCHEMA_VERSION_UNSUPPORTED",
    );
    await db.pool.query("UPDATE rutas_installation SET schema_version=3");
  });
  it("cannot deactivate each other concurrently and leave zero active admins", async () => {
    const a = await createUser(db.pool, actor, {
      name: "Concurrent A",
      login: "concurrent-a",
      password,
    });
    const b = await createUser(db.pool, actor, {
      name: "Concurrent B",
      login: "concurrent-b",
      password,
    });
    const results = await Promise.allSettled([
      setUserActive(db.pool, a.id, b.id, false),
      setUserActive(db.pool, b.id, a.id, false),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const inactive = (
      await db.pool.query(
        "SELECT id FROM route_users WHERE id=ANY($1::uuid[]) AND active=false",
        [[a.id, b.id]],
      )
    ).rows[0].id;
    await expect(
      createPlan(db.pool, inactive, { date: "2026-10-20", label: "Denied" }),
    ).rejects.toThrow("UNAUTHENTICATED");
    const [plan] = await listPlans(db.pool);
    await expect(
      editPlan(db.pool, inactive, plan.id, {
        expectedVersion: plan.version,
        label: "Denied",
      }),
    ).rejects.toThrow("UNAUTHENTICATED");
  });
  it("does not accept another installation session, even with the same user login", async () => {
    await db.server.createDatabase("qa_second_installation");
    const connection = new URL(db.config.databaseUrl);
    connection.pathname = "/qa_second_installation";
    const other = createPool(connection.href);
    try {
      const config = {
        ...db.config,
        databaseUrl: connection.href,
        instanceId: randomUUID(),
      };
      await migrate(other, config.instanceId);
      await bootstrap(other, config, {
        token: config.bootstrapToken,
        name: "Separate QA",
        login: "qa-admin",
        password,
      });
      await expect(authenticate(other, config, token)).rejects.toThrow(
        "UNAUTHENTICATED",
      );
      expect(await listPlans(other)).toEqual([]);
    } finally {
      await other.end();
    }
  });
});
