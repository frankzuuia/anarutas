import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "./errors";
import { transaction, type Sql } from "./database";
import { fleetLock, getDriver } from "./fleet";
import { hashPassword, newToken, tokenHash, verifyPassword } from "./crypto";
import { throttle } from "./auth";
import { normalizeDriverPhone } from "./driver-phone";

const invalidLogin = () => new AppError("MOBILE_LOGIN_INVALID", 401);

export function mobilePhoneKey(value: unknown) {
  const phone = normalizeDriverPhone(value);
  if (!phone) throw new AppError("MOBILE_PHONE_INVALID");
  return phone;
}

export function mobilePin(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length !== 4 ||
    [...value].some((char) => char < "0" || char > "9")
  )
    throw new AppError("MOBILE_PIN_INVALID");
  return value;
}

function pinPepper() {
  const pepper = process.env.RUTAS_DRIVER_PIN_PEPPER;
  if (!pepper || Buffer.byteLength(pepper, "utf8") < 32)
    throw new AppError("MOBILE_CONFIG_MISSING", 503);
  return pepper;
}

function pinMaterial(driverId: string, pin: string) {
  return createHmac("sha256", pinPepper())
    .update("ana-rutas:driver-pin:v1")
    .update(driverId)
    .update(pin)
    .digest("hex");
}

async function mobileAudit(
  sql: Sql,
  driverId: string,
  action: string,
  adminActorId: string | null = null,
  details: Record<string, unknown> = {},
) {
  await sql.query(
    `INSERT INTO route_driver_mobile_audit(driver_id,admin_actor_id,action,details)
     VALUES($1,$2,$3,$4)`,
    [driverId, adminActorId, action, JSON.stringify(details)],
  );
}

export async function mobileAccessStatus(sql: Sql, driverId: string) {
  const { rows } = await sql.query(
    `SELECT a.enabled,a.version,
       (SELECT count(*)::integer FROM route_driver_mobile_devices d
        WHERE d.driver_id=a.driver_id AND d.revoked_at IS NULL) AS devices
     FROM route_driver_mobile_access a WHERE a.driver_id=$1`,
    [driverId],
  );
  return rows[0] ?? { enabled: false, version: 0, devices: 0 };
}

export async function configureMobileAccess(
  pool: Pool,
  adminActor: string,
  driverId: string,
  input: Record<string, unknown>,
) {
  const pin = mobilePin(input.pin);
  const material = pinMaterial(driverId, pin);
  const hash = await hashPassword(material);
  return transaction(pool, async (sql) => {
    await fleetLock(sql, adminActor);
    const driver = await getDriver(sql, driverId);
    const current = await mobileAccessStatus(sql, driverId);
    if (input.expectedMobileVersion !== current.version)
      throw new AppError("MOBILE_VERSION_CONFLICT", 409);
    if (!driver.active) throw new AppError("FLEET_UNAVAILABLE", 409);
    const phone = mobilePhoneKey(driver.phone);
    const duplicate = await sql.query(
      `SELECT driver_id FROM route_driver_mobile_access
       WHERE login_phone=$1 AND enabled AND driver_id<>$2`,
      [phone, driverId],
    );
    if (duplicate.rowCount) throw new AppError("MOBILE_PHONE_EXISTS", 409);
    await sql.query(
      `INSERT INTO route_driver_mobile_access
       (driver_id,login_phone,pin_hash,updated_by)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(driver_id) DO UPDATE SET
         login_phone=EXCLUDED.login_phone,pin_hash=EXCLUDED.pin_hash,
         enabled=true,version=route_driver_mobile_access.version+1,
         failed_attempts=0,locked_until=NULL,updated_by=EXCLUDED.updated_by,
         updated_at=now()`,
      [driverId, phone, hash, adminActor],
    );
    await sql.query(
      "UPDATE route_driver_mobile_devices SET revoked_at=now() WHERE driver_id=$1 AND revoked_at IS NULL",
      [driverId],
    );
    await sql.query(
      "UPDATE route_mobile_push_registrations SET disabled_at=now() WHERE driver_id=$1 AND disabled_at IS NULL",
      [driverId],
    );
    await sql.query(
      "UPDATE route_driver_mobile_sessions SET revoked_at=now() WHERE driver_id=$1 AND revoked_at IS NULL",
      [driverId],
    );
    await sql.query(
      "DELETE FROM route_driver_mobile_activations WHERE driver_id=$1",
      [driverId],
    );
    await sql.query(
      "DELETE FROM route_driver_mobile_challenges WHERE driver_id=$1",
      [driverId],
    );
    await mobileAudit(sql, driverId, "mobile.access.configured", adminActor);
    return mobileAccessStatus(sql, driverId);
  });
}

export async function revokeMobileAccess(
  pool: Pool,
  adminActor: string,
  driverId: string,
  expectedMobileVersion: unknown,
) {
  return transaction(pool, async (sql) => {
    await fleetLock(sql, adminActor);
    await getDriver(sql, driverId);
    const current = await mobileAccessStatus(sql, driverId);
    if (expectedMobileVersion !== current.version)
      throw new AppError("MOBILE_VERSION_CONFLICT", 409);
    await sql.query(
      "UPDATE route_driver_mobile_access SET enabled=false,version=version+1,updated_by=$2,updated_at=now() WHERE driver_id=$1",
      [driverId, adminActor],
    );
    await sql.query(
      "UPDATE route_driver_mobile_devices SET revoked_at=now() WHERE driver_id=$1 AND revoked_at IS NULL",
      [driverId],
    );
    await sql.query(
      "UPDATE route_mobile_push_registrations SET disabled_at=now() WHERE driver_id=$1 AND disabled_at IS NULL",
      [driverId],
    );
    await sql.query(
      "UPDATE route_driver_mobile_sessions SET revoked_at=now() WHERE driver_id=$1 AND revoked_at IS NULL",
      [driverId],
    );
    await sql.query(
      "DELETE FROM route_driver_mobile_activations WHERE driver_id=$1",
      [driverId],
    );
    await sql.query(
      "DELETE FROM route_driver_mobile_challenges WHERE driver_id=$1",
      [driverId],
    );
    await mobileAudit(sql, driverId, "mobile.access.revoked", adminActor);
    return mobileAccessStatus(sql, driverId);
  });
}

function canonicalPublicKey(value: unknown) {
  if (typeof value !== "string" || value.length > 1024)
    throw new AppError("MOBILE_DEVICE_INVALID");
  try {
    const key = createPublicKey(value);
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      throw new Error("curve");
    return key.export({ type: "spki", format: "pem" }).toString();
  } catch {
    throw new AppError("MOBILE_DEVICE_INVALID");
  }
}

function mobileUuid(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw invalidLogin();
  return value;
}

async function throttleMobile(pool: Pool, phone: string) {
  await throttle(pool, "mobile:global", 120);
  await throttle(pool, `mobile:${tokenHash(phone)}`, 8);
}

async function recordFailedPin(sql: Sql, driverId: string) {
  await sql.query(
    `UPDATE route_driver_mobile_access SET
       failed_attempts=failed_attempts+1,
       locked_until=CASE WHEN failed_attempts+1>=5
         THEN now()+interval '15 minutes' ELSE locked_until END
     WHERE driver_id=$1`,
    [driverId],
  );
  await mobileAudit(sql, driverId, "mobile.login.denied");
}

function locked(access: { locked_until: Date | null }) {
  return Boolean(access.locked_until && access.locked_until > new Date());
}

export async function enrollMobileDevice(
  pool: Pool,
  input: Record<string, unknown>,
) {
  const phone = mobilePhoneKey(input.phone);
  const pin = mobilePin(input.pin);
  const publicKey = canonicalPublicKey(input.publicKey);
  const publicKeyHash = createHash("sha256").update(publicKey).digest("hex");
  await throttleMobile(pool, phone);
  const token = newToken();
  const result = await transaction(pool, async (sql) => {
    const { rows } = await sql.query(
      `SELECT a.driver_id,a.pin_hash,a.locked_until,d.active
       FROM route_driver_mobile_access a
       JOIN route_drivers d ON d.id=a.driver_id
       WHERE a.login_phone=$1 AND a.enabled FOR UPDATE OF a`,
      [phone],
    );
    const access = rows[0];
    const validPin = await verifyPassword(
      pinMaterial(access?.driver_id ?? "", pin),
      access?.pin_hash ?? null,
    );
    if (!access?.active || locked(access) || !validPin) {
      if (access) await recordFailedPin(sql, access.driver_id);
      return null;
    }
    const enrolled = await sql.query(
      `INSERT INTO route_driver_mobile_devices
       (id,driver_id,public_key,public_key_hash) VALUES($1,$2,$3,$4)
       ON CONFLICT(public_key_hash) DO UPDATE SET
         public_key=EXCLUDED.public_key,revoked_at=NULL
       WHERE route_driver_mobile_devices.driver_id=EXCLUDED.driver_id
       RETURNING id`,
      [randomUUID(), access.driver_id, publicKey, publicKeyHash],
    );
    const deviceId = enrolled.rows[0]?.id as string | undefined;
    if (!deviceId) return null;
    await sql.query(
      `UPDATE route_driver_mobile_access SET failed_attempts=0,locked_until=NULL
       WHERE driver_id=$1`,
      [access.driver_id],
    );
    await sql.query(
      `INSERT INTO route_driver_mobile_sessions
       (token_hash,driver_id,device_id,expires_at)
       VALUES($1,$2,$3,now()+interval '12 hours')`,
      [tokenHash(token), access.driver_id, deviceId],
    );
    await mobileAudit(sql, access.driver_id, "mobile.device.enrolled", null, {
      deviceId,
    });
    return { driverId: access.driver_id as string, deviceId };
  });
  if (!result) throw invalidLogin();
  return { ...result, token };
}

export async function createMobileChallenge(
  pool: Pool,
  input: Record<string, unknown>,
) {
  const phone = mobilePhoneKey(input.phone);
  const deviceId = mobileUuid(input.deviceId);
  await throttleMobile(pool, phone);
  const nonce = randomBytes(32).toString("hex");
  const id = randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO route_driver_mobile_challenges
     (id,driver_id,device_id,nonce_hash,expires_at)
     SELECT $1,a.driver_id,d.id,$2,now()+interval '2 minutes'
       FROM route_driver_mobile_access a
       JOIN route_drivers r ON r.id=a.driver_id
       JOIN route_driver_mobile_devices d ON d.driver_id=a.driver_id
      WHERE a.login_phone=$3 AND a.enabled AND r.active
        AND d.id=$4 AND d.revoked_at IS NULL
      RETURNING id`,
    [id, tokenHash(nonce), phone, deviceId],
  );
  if (!rows.length) throw invalidLogin();
  return { challengeId: id, nonce };
}

export function mobileChallengeMessage(challengeId: string, nonce: string) {
  return `ana-rutas-mobile-login-v1:${challengeId}:${nonce}`;
}

export async function loginMobile(pool: Pool, input: Record<string, unknown>) {
  const phone = mobilePhoneKey(input.phone);
  const pin = mobilePin(input.pin);
  const deviceId = mobileUuid(input.deviceId);
  const challengeId = mobileUuid(input.challengeId);
  const nonce = input.nonce;
  const signature = input.signature;
  if (
    typeof nonce !== "string" ||
    !/^[0-9a-f]{64}$/.test(nonce) ||
    typeof signature !== "string" ||
    signature.length > 256
  )
    throw invalidLogin();
  await throttleMobile(pool, phone);
  const token = newToken();
  const result = await transaction(pool, async (sql) => {
    const { rows } = await sql.query(
      `SELECT a.driver_id,a.pin_hash,a.locked_until,r.active,
              d.public_key,d.revoked_at
       FROM route_driver_mobile_access a
       JOIN route_drivers r ON r.id=a.driver_id
       LEFT JOIN route_driver_mobile_devices d
         ON d.driver_id=a.driver_id AND d.id=$2
       WHERE a.login_phone=$1 AND a.enabled FOR UPDATE OF a`,
      [phone, deviceId],
    );
    const access = rows[0];
    const challenge = await sql.query(
      `DELETE FROM route_driver_mobile_challenges
       WHERE id=$1 AND device_id=$2 RETURNING driver_id,nonce_hash,expires_at`,
      [challengeId, deviceId],
    );
    const validPin = await verifyPassword(
      pinMaterial(access?.driver_id ?? "", pin),
      access?.pin_hash ?? null,
    );
    let validSignature = false;
    if (access?.public_key) {
      try {
        validSignature = verify(
          "sha256",
          Buffer.from(mobileChallengeMessage(challengeId, nonce), "utf8"),
          createPublicKey(access.public_key),
          Buffer.from(signature, "base64"),
        );
      } catch {
        validSignature = false;
      }
    }
    const claim = challenge.rows[0];
    if (
      !access?.active ||
      locked(access) ||
      !validPin ||
      access.revoked_at ||
      !validSignature ||
      !claim ||
      claim.driver_id !== access.driver_id ||
      claim.expires_at <= new Date() ||
      claim.nonce_hash !== tokenHash(nonce)
    ) {
      if (access) await recordFailedPin(sql, access.driver_id);
      return null;
    }
    await sql.query(
      `UPDATE route_driver_mobile_access SET failed_attempts=0,locked_until=NULL
       WHERE driver_id=$1`,
      [access.driver_id],
    );
    await sql.query(
      `INSERT INTO route_driver_mobile_sessions
       (token_hash,driver_id,device_id,expires_at)
       VALUES($1,$2,$3,now()+interval '12 hours')`,
      [tokenHash(token), access.driver_id, deviceId],
    );
    await mobileAudit(sql, access.driver_id, "mobile.session.login", null, {
      deviceId,
    });
    return { driverId: access.driver_id as string, deviceId };
  });
  if (!result) throw invalidLogin();
  return { ...result, token };
}

export async function authenticateMobile(pool: Sql, header: string | null, lock = false) {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!/^[0-9a-f]{64}$/.test(token))
    throw new AppError("MOBILE_UNAUTHENTICATED", 401);
  if (lock) {
    const owner = await authenticateMobile(pool, header);
    // Explicit order matches admin driver/access/device/session revocation. A joined
    // FOR SHARE can acquire row locks in planner order and deadlock with that path.
    await pool.query("SELECT id FROM route_drivers WHERE id=$1 FOR SHARE", [owner.driver_id]);
    await pool.query("SELECT driver_id FROM route_driver_mobile_access WHERE driver_id=$1 FOR SHARE", [owner.driver_id]);
    await pool.query("SELECT id FROM route_driver_mobile_devices WHERE id=$1 FOR SHARE", [owner.device_id]);
    await pool.query("SELECT token_hash FROM route_driver_mobile_sessions WHERE token_hash=$1 FOR SHARE", [tokenHash(token)]);
  }
  const { rows } = await pool.query(
    `SELECT s.driver_id,s.device_id,d.name,d.phone
       FROM route_driver_mobile_sessions s
       JOIN route_driver_mobile_devices v
         ON v.id=s.device_id AND v.driver_id=s.driver_id
       JOIN route_driver_mobile_access a ON a.driver_id=s.driver_id
       JOIN route_drivers d ON d.id=s.driver_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL
        AND v.revoked_at IS NULL AND a.enabled AND d.active`,
    [tokenHash(token)],
  );
  if (!rows.length) throw new AppError("MOBILE_UNAUTHENTICATED", 401);
  return rows[0] as { driver_id: string; device_id: string; name: string; phone: string };
}

export async function logoutMobile(pool: Pool, header: string | null) {
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!/^[0-9a-f]{64}$/.test(token))
    throw new AppError("MOBILE_UNAUTHENTICATED", 401);
  await transaction(pool, async (sql) => {
    const result = await sql.query(
      `UPDATE route_driver_mobile_sessions SET revoked_at=now()
       WHERE token_hash=$1 AND revoked_at IS NULL RETURNING driver_id,device_id`,
      [tokenHash(token)],
    );
    if (result.rows[0]) {
      await sql.query(
        "UPDATE route_mobile_push_registrations SET disabled_at=now() WHERE device_id=$1 AND disabled_at IS NULL",
        [result.rows[0].device_id],
      );
      await mobileAudit(sql, result.rows[0].driver_id, "mobile.session.logout");
    }
  });
}
