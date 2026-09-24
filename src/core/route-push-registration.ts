import type { Pool } from "pg";
import { transaction } from "./database";
import { AppError } from "./errors";
import { tokenHash } from "./crypto";

export function firebaseInstallationId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(value))
    throw new AppError("MOBILE_PUSH_ID_INVALID");
  return value;
}

export async function registerMobilePush(
  pool: Pool,
  principal: { driver_id: string; device_id: string },
  value: unknown,
  authorization: string | null,
) {
  const fid = firebaseInstallationId(value);
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!/^[0-9a-f]{64}$/.test(bearer)) throw new AppError("MOBILE_UNAUTHENTICATED", 401);
  await transaction(pool, async (sql) => {
    const current = await sql.query(
      `SELECT s.driver_id,s.device_id FROM route_driver_mobile_sessions s
         JOIN route_driver_mobile_devices d ON d.id=s.device_id AND d.driver_id=s.driver_id
         JOIN route_driver_mobile_access a ON a.driver_id=s.driver_id
         JOIN route_drivers f ON f.id=s.driver_id
        WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL
          AND d.revoked_at IS NULL AND a.enabled AND f.active
        FOR SHARE OF s,d,a,f`,
      [tokenHash(bearer)],
    );
    if (current.rows[0]?.driver_id !== principal.driver_id ||
        current.rows[0]?.device_id !== principal.device_id)
      throw new AppError("MOBILE_UNAUTHENTICATED", 401);
    await sql.query(
      `DELETE FROM route_mobile_push_registrations r USING route_driver_mobile_devices d
        WHERE r.device_id=d.id AND r.fid=$1 AND r.device_id<>$2
          AND (r.disabled_at IS NOT NULL OR d.revoked_at IS NOT NULL)`,
      [fid, principal.device_id],
    );
    await sql.query(
      `INSERT INTO route_mobile_push_registrations(device_id,driver_id,fid)
       VALUES($1,$2,$3)
       ON CONFLICT(device_id) DO UPDATE SET
         fid=EXCLUDED.fid,driver_id=EXCLUDED.driver_id,
         updated_at=now(),disabled_at=NULL`,
      [principal.device_id, principal.driver_id, fid],
    );
  });
  return { registered: true };
}
