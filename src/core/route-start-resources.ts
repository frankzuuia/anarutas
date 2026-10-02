import type { Sql } from "./database";
import { AppError } from "./errors";
import { publicationExecutionJoinSql } from "./route-lifecycle";

/** Called under the fleet transaction lock; work receipts only append. */
export async function assertRouteResourcesFree(
  sql: Sql,
  driverId: string,
  vehicleId: string,
) {
  const occupied = await sql.query(
    `
    SELECT pub.plan_id FROM route_plan_publications pub
    ${publicationExecutionJoinSql}
    LEFT JOIN route_driver_work_completions w ON w.execution_id=e.id
    WHERE pub.started_at IS NOT NULL AND pub.revoked_at IS NULL
      AND (pub.started_driver_id=$1 OR pub.vehicle_id=$2)
      AND w.execution_id IS NULL
    LIMIT 1`,
    [driverId, vehicleId],
  );
  if (occupied.rowCount) throw new AppError("DRIVER_ROUTE_IN_PROGRESS", 409);
}
