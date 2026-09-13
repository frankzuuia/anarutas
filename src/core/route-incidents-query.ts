import type { Pool } from "pg";
import { transaction } from "./database";
import { readOrderBoard } from "./orders";
import { readPlanOptimization } from "./route-optimization";
import { forecastIncidents, type IncidentReport } from "./route-incidents";

export async function readRouteIncidents(
  pool: Pool,
  planId: string,
): Promise<IncidentReport> {
  return transaction(pool, async (sql) => {
    // A consistent MVCC snapshot prevents combining old ETA with new customer
    // windows. Existing board reads use SELECT FOR SHARE; no DML is executed.
    await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const board = await readOrderBoard(sql, planId);
    const calculation = await readPlanOptimization(sql, planId);
    return { plan: board.plan, ...forecastIncidents(board, calculation) };
  });
}
