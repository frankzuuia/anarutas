import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "./errors";
import { integer, uuid } from "./orders-validation";

export async function acquireOptimizationLease(
  pool: Pool,
  planId: string,
  basePlanVersion: number,
  requestHash: string,
  timeoutSeconds: number,
) {
  const id = uuid(planId);
  const version = integer(basePlanVersion, 1);
  const timeout = integer(timeoutSeconds, 1);
  if (
    requestHash.length !== 64 ||
    [...requestHash].some(
      (character) => !"0123456789abcdef".includes(character),
    )
  )
    throw new AppError("INVALID_INPUT");
  const token = randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO route_optimization_leases(
       plan_id,token,base_plan_version,request_hash,expires_at
     ) VALUES($1,$2,$3,$4,now()+$5::integer*interval '1 second')
     ON CONFLICT(plan_id) DO UPDATE SET
       token=EXCLUDED.token,
       base_plan_version=EXCLUDED.base_plan_version,
       request_hash=EXCLUDED.request_hash,
       expires_at=EXCLUDED.expires_at,
       updated_at=now()
     WHERE route_optimization_leases.expires_at<=now()
        OR route_optimization_leases.base_plan_version<>EXCLUDED.base_plan_version
     RETURNING token`,
    [id, token, version, requestHash, timeout + 60],
  );
  if (!rows.length) throw new AppError("ROUTING_ALREADY_RUNNING", 409);
  return token;
}

export async function releaseOptimizationLease(
  pool: Pool,
  planId: string,
  token: string,
) {
  await pool.query(
    "DELETE FROM route_optimization_leases WHERE plan_id=$1 AND token=$2",
    [uuid(planId), uuid(token)],
  );
}

export async function renewOptimizationLease(
  pool: Pool,
  planId: string,
  token: string,
  timeoutSeconds: number,
) {
  const timeout = integer(timeoutSeconds, 1);
  const result = await pool.query(
    `UPDATE route_optimization_leases SET expires_at=now()+$3::integer*interval '1 second',updated_at=now()
     WHERE plan_id=$1 AND token=$2 RETURNING plan_id`,
    [uuid(planId), uuid(token), timeout + 60],
  );
  if (!result.rowCount) throw new AppError("VERSION_CONFLICT", 409);
}
