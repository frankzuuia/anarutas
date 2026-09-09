import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";
import { passwordAllowed } from "./policy";

const work = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
let inFlight = 0;
async function derive(password: string, salt: Buffer) {
  // Memory-safety guard, not an LLM/business budget. No queue of unbounded hashes.
  if (inFlight >= 2) throw new AppError("AUTH_BUSY", 429);
  inFlight++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(password, salt, 64, work, (error, key) =>
        error ? reject(error) : resolve(key),
      ),
    );
  } finally {
    inFlight--;
  }
}
export const newToken = () => randomBytes(32).toString("hex");
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function secretMatches(actual: string, expected: string) {
  return (
    expected.length >= 32 &&
    timingSafeEqual(
      Buffer.from(tokenHash(actual)),
      Buffer.from(tokenHash(expected)),
    )
  );
}
export async function hashPassword(password: string) {
  if (!passwordAllowed(password)) throw new AppError("PASSWORD_POLICY");
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt-v1$${salt.toString("hex")}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string | null) {
  const parts = encoded?.split("$") || [];
  const valid =
    parts.length === 3 &&
    parts[0] === "scrypt-v1" &&
    parts[1].length === 32 &&
    parts[2].length === 128;
  const salt = valid ? Buffer.from(parts[1], "hex") : Buffer.alloc(16);
  const key = await derive(password.slice(0, 128), salt);
  const expected = valid ? Buffer.from(parts[2], "hex") : Buffer.alloc(64);
  return (
    valid &&
    password.length <= 128 &&
    expected.length === key.length &&
    timingSafeEqual(key, expected)
  );
}
