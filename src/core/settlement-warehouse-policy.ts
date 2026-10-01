import type { Sql } from "./database";
import { AppError } from "./errors";

export async function settlementWarehouseRequired(sql: Sql) {
  const { rows } = await sql.query(
    "SELECT settlement_require_warehouse FROM route_driver_operation_settings WHERE singleton=true FOR SHARE",
  );
  if (typeof rows[0]?.settlement_require_warehouse !== "boolean")
    throw new AppError("OPERATION_SETTINGS_MISSING", 503);
  return rows[0].settlement_require_warehouse as boolean;
}
