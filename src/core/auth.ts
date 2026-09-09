import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertActiveActor, audit, transaction } from "./database";
import { AppError } from "./errors";
import {
  hashPassword,
  newToken,
  secretMatches,
  tokenHash,
  verifyPassword,
} from "./crypto";
import { sessionUsable } from "./policy";
import type { readConfig } from "./config";

type Config = ReturnType<typeof readConfig>;
export type User = { id: string; name: string; login: string; active: boolean };
export function textField(value: unknown, min = 1, max = 120): string {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw new AppError("INVALID_INPUT");
  return value.trim();
}
export function passwordField(value: unknown): string {
  if (typeof value !== "string" || value.length > 128)
    throw new AppError("INVALID_INPUT");
  return value;
}
const loginKey = (value: unknown) =>
  textField(value, 3).normalize("NFKC").toLowerCase();
export async function throttle(
  pool: Pool,
  key: string,
  maximum: number,
  seconds = 60,
) {
  const { rows } = await pool.query(
    `INSERT INTO auth_attempts(key,attempts,expires_at) VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_attempts.expires_at<=now() THEN 1 ELSE auth_attempts.attempts+1 END,
    expires_at=CASE WHEN auth_attempts.expires_at<=now() THEN EXCLUDED.expires_at ELSE auth_attempts.expires_at END RETURNING attempts`,
    [key, seconds],
  );
  if (rows[0].attempts > maximum) throw new AppError("TOO_MANY_ATTEMPTS", 429);
}
async function insertUser(
  sql: Parameters<typeof audit>[0],
  input: Record<string, unknown>,
  passwordHash: string,
): Promise<User> {
  const id = randomUUID();
  const result = await sql.query(
    "INSERT INTO route_users(id,name,login,password_hash) VALUES($1,$2,$3,$4) RETURNING id,name,login,active",
    [id, textField(input.name, 2), loginKey(input.login), passwordHash],
  );
  return result.rows[0];
}
export async function bootstrap(
  pool: Pool,
  config: Config,
  input: Record<string, unknown>,
) {
  await throttle(pool, "bootstrap", 10);
  if (
    typeof input.token !== "string" ||
    !secretMatches(input.token, config.bootstrapToken)
  )
    throw new AppError("SETUP_DENIED", 403);
  const passwordHash = await hashPassword(passwordField(input.password));
  return transaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('ana-rutas:bootstrap'))",
    );
    const existing = await client.query("SELECT id FROM route_users LIMIT 1");
    if (existing.rowCount) throw new AppError("SETUP_DENIED", 403);
    const user = await insertUser(client, input, passwordHash);
    await audit(client, user.id, "account.bootstrap", user.id);
    return user;
  });
}
export async function login(
  pool: Pool,
  config: Config,
  input: Record<string, unknown>,
) {
  await throttle(pool, "login:global", 30);
  const key = loginKey(input.login);
  await throttle(pool, `login:${tokenHash(key)}`, 6);
  const password = passwordField(input.password);
  const { rows } = await pool.query(
    "SELECT id,name,login,active,password_hash FROM route_users WHERE login=$1",
    [key],
  );
  const candidate = rows[0];
  const valid = await verifyPassword(
    password,
    candidate?.password_hash ?? null,
  );
  if (!valid || !candidate?.active) throw new AppError("LOGIN_INVALID", 401);
  const token = newToken();
  await transaction(pool, async (client) => {
    // Serialize against account deactivation before creating a usable session.
    const locked = await client.query(
      "SELECT active FROM route_users WHERE id=$1 FOR UPDATE",
      [candidate.id],
    );
    if (!locked.rows[0]?.active) throw new AppError("LOGIN_INVALID", 401);
    await client.query(
      `INSERT INTO route_sessions(token_hash,user_id,expires_at,idle_expires_at) VALUES($1,$2,now()+$3*interval '1 hour',now()+$4*interval '1 minute')`,
      [tokenHash(token), candidate.id, config.sessionHours, config.idleMinutes],
    );
    await audit(client, candidate.id, "session.login");
  });
  return {
    token,
    user: {
      id: candidate.id,
      name: candidate.name,
      login: candidate.login,
      active: candidate.active,
    } as User,
  };
}
export async function authenticate(
  pool: Pool,
  config: Config,
  token: string | undefined,
): Promise<User> {
  if (!token || token.length !== 64) throw new AppError("UNAUTHENTICATED", 401);
  const { rows } = await pool.query(
    `SELECT u.id,u.name,u.login,u.active,s.expires_at,s.idle_expires_at,s.revoked_at,now() AS now
    FROM route_sessions s JOIN route_users u ON u.id=s.user_id WHERE s.token_hash=$1`,
    [tokenHash(token)],
  );
  const row = rows[0];
  if (
    !row ||
    !sessionUsable(
      row.active,
      Boolean(row.revoked_at),
      row.expires_at.getTime(),
      row.idle_expires_at.getTime(),
      row.now.getTime(),
    )
  )
    throw new AppError("UNAUTHENTICATED", 401);
  await pool.query(
    `UPDATE route_sessions SET idle_expires_at=LEAST(expires_at,now()+$2*interval '1 minute') WHERE token_hash=$1 AND revoked_at IS NULL`,
    [tokenHash(token), config.idleMinutes],
  );
  return { id: row.id, name: row.name, login: row.login, active: row.active };
}
export async function logout(pool: Pool, actor: string, token: string) {
  await transaction(pool, async (client) => {
    await client.query(
      "UPDATE route_sessions SET revoked_at=now() WHERE token_hash=$1 AND user_id=$2",
      [tokenHash(token), actor],
    );
    await audit(client, actor, "session.logout");
  });
}
export async function createUser(
  pool: Pool,
  actor: string,
  input: Record<string, unknown>,
) {
  await throttle(pool, `create-user:${actor}`, 10);
  const hash = await hashPassword(passwordField(input.password));
  return transaction(pool, async (client) => {
    await assertActiveActor(client, actor);
    const user = await insertUser(client, input, hash);
    await audit(client, actor, "account.created", user.id);
    return user;
  });
}
export async function setUserActive(
  pool: Pool,
  actor: string,
  id: string,
  active: unknown,
) {
  if (typeof active !== "boolean") throw new AppError("INVALID_INPUT");
  if (actor === id) throw new AppError("SELF_DEACTIVATION", 409);
  return transaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('ana-rutas:accounts'))",
    );
    await assertActiveActor(client, actor);
    const result = await client.query(
      "UPDATE route_users SET active=$2 WHERE id=$1 RETURNING id,name,login,active",
      [id, active],
    );
    if (!result.rowCount) throw new AppError("NOT_FOUND", 404);
    if (!active)
      await client.query(
        "UPDATE route_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
        [id],
      );
    await audit(
      client,
      actor,
      active ? "account.activated" : "account.deactivated",
      id,
    );
    return result.rows[0] as User;
  });
}
