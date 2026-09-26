import type { Pool } from "pg";
import { transaction, type Sql } from "./database";
import { AppError } from "./errors";
import { authenticateMobile } from "./driver-mobile-auth";
import { executableRoute } from "./driver-execution-read";
import { uuid } from "./orders-validation";

export type DriverCommandResult = {
  eventId: string | null; occurredAt: string; executionRevision: number;
  duplicate: boolean; unchanged?: boolean; incidentId?: string | null;
};

export async function driverCommandReceipt(sql: Sql, deviceId: string, commandId: string, hash: string) {
  const { rows } = await sql.query(
    "SELECT request_hash,result FROM route_driver_command_receipts WHERE device_id=$1 AND command_id=$2",
    [deviceId, commandId],
  );
  if (!rows[0]) return null;
  if (rows[0].request_hash !== hash) throw new AppError("COMMAND_REUSED", 409);
  return { ...rows[0].result, duplicate: true } as DriverCommandResult;
}

export async function saveDriverCommandReceipt(sql: Sql, deviceId: string, commandId: string,
  hash: string, executionId: string, result: DriverCommandResult) {
  await sql.query(
    "INSERT INTO route_driver_command_receipts(device_id,command_id,request_hash,execution_id,result) VALUES($1,$2,$3,$4,$5)",
    [deviceId, commandId, hash, executionId, JSON.stringify(result)],
  );
  return result;
}

// A private recovery read can confirm a committed photo command even if Android
// reclaimed its local file after a process death. A missing receipt is not success.
export async function readDriverCommandResult(pool: Pool, authorization: string | null, planId: string, commandId: string) {
  const id = uuid(commandId);
  return transaction(pool, async sql => {
    const driver = await authenticateMobile(sql, authorization, true);
    const route = await executableRoute(sql, driver.driver_id, planId, false);
    const row = (await sql.query(`SELECT result FROM route_driver_command_receipts
      WHERE device_id=$1 AND command_id=$2 AND execution_id=$3`, [driver.device_id, id, route.id])).rows[0];
    return { confirmed: Boolean(row), result: row?.result ?? null };
  });
}
