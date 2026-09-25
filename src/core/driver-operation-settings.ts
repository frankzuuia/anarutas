import type { Pool } from "pg";
import { assertActiveActor, audit, transaction, type Sql } from "./database";
import { AppError } from "./errors";
import { operationPolicyInput, type OperationPolicy } from "./driver-execution-policy";

export async function readOperationPolicy(sql: Sql, lock = false): Promise<OperationPolicy> {
  const { rows } = await sql.query(`SELECT * FROM route_driver_operation_settings WHERE singleton=true${lock ? " FOR SHARE" : ""}`);
  if (!rows[0]) throw new AppError("OPERATION_SETTINGS_MISSING", 503);
  return {
    radiusMeters: rows[0].radius_meters,
    maxAccuracyMeters: rows[0].max_accuracy_meters,
    maxSampleAgeSeconds: rows[0].max_sample_age_seconds,
    version: rows[0].version,
  };
}

export async function saveOperationPolicy(pool: Pool, actor: string, input: Record<string, unknown>) {
  const policy = operationPolicyInput(input);
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const { rowCount } = await sql.query(
      `UPDATE route_driver_operation_settings SET radius_meters=$1,max_accuracy_meters=$2,
         max_sample_age_seconds=$3,version=version+1,updated_by=$4,updated_at=now()
       WHERE singleton=true AND version=$5`,
      [policy.radiusMeters, policy.maxAccuracyMeters, policy.maxSampleAgeSeconds, actor, policy.version],
    );
    if (!rowCount) throw new AppError("VERSION_CONFLICT", 409);
    await audit(sql, actor, "driver.operation.settings.updated", "arrival", { ...policy, version: policy.version + 1 });
    return readOperationPolicy(sql);
  });
}
