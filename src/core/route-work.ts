import type { Pool } from "pg";
import { transaction, type Sql } from "./database";
import { uuid } from "./orders-validation";
import { AppError } from "./errors";
import { financialHash } from "./financial-policy";
import { lockFinanceExecution, financeOrders } from "./finance-context";
import { authenticateMobile } from "./driver-mobile-auth";
import { paymentRecords } from "./payments";
import { settlementRecords } from "./settlements";
import { settlementWarehouseRequired } from "./settlement-warehouse-policy";
import {
  routeWorkReview,
  type WorkOrder,
  type WorkReceipt,
  type WorkRequest,
} from "./route-work-policy";

export async function workCompletionRecord(sql: Sql, executionId: string) {
  const row = (
    await sql.query(
      "SELECT completed_at,snapshot FROM route_driver_work_completions WHERE execution_id=$1",
      [executionId],
    )
  ).rows[0];
  return row
    ? {
        completedAt: row.completed_at.toISOString() as string,
        summary: row.snapshot as ReturnType<typeof routeWorkReview>["summary"],
      }
    : null;
}
export async function readRouteWork(
  sql: Sql,
  executionId: string,
  completed: boolean,
  orders: WorkOrder[],
  payments: WorkReceipt[],
  requests: WorkRequest[],
  warehouseRequired = true,
) {
  return {
    ...routeWorkReview(
      executionId,
      completed,
      orders,
      payments,
      requests,
      warehouseRequired,
    ),
    completion: await workCompletionRecord(sql, executionId),
  };
}
export async function completeDriverWork(
  pool: Pool,
  authorization: string | null,
  executionId: string,
  raw: Record<string, unknown>,
  now = new Date(),
) {
  const commandId = uuid(raw.commandId);
  if (typeof raw.basis !== "string" || raw.basis.length !== 64)
    throw new AppError("WORK_REVIEW_REQUIRED");
  const basis = raw.basis;
  const hash = financialHash({ executionId, basis });
  return transaction(pool, async (sql) => {
    const driver = await authenticateMobile(sql, authorization, true);
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `driver-work:${driver.device_id}:${commandId}`,
    ]);
    const route = await lockFinanceExecution(
      sql,
      executionId,
      driver.driver_id,
    );
    const prior = (
      await sql.query(
        "SELECT execution_id,request_hash FROM route_driver_work_completions WHERE device_id=$1 AND command_id=$2",
        [driver.device_id, commandId],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash)
        throw new AppError("COMMAND_REUSED", 409);
      return {
        ...(await workCompletionRecord(sql, prior.execution_id)),
        duplicate: true,
      };
    }
    const completed = await workCompletionRecord(sql, route.id);
    if (completed) return { ...completed, duplicate: true };
    const orders = await financeOrders(sql, route);
    const payments = await paymentRecords(sql, route.id);
    const requests = await settlementRecords(sql, route.id);
    const warehouseRequired = await settlementWarehouseRequired(sql);
    const review = routeWorkReview(
      route.id,
      Boolean(route.completed_at),
      orders,
      payments,
      requests,
      warehouseRequired,
    );
    if (!review.eligible) throw new AppError(review.reason!, 409);
    if (review.basis !== basis) throw new AppError("WORK_VERSION_CHANGED", 409);
    await sql.query(
      `INSERT INTO route_driver_work_completions(execution_id,driver_id,device_id,command_id,request_hash,completed_at,snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        route.id,
        driver.driver_id,
        driver.device_id,
        commandId,
        hash,
        now,
        JSON.stringify(review.summary),
      ],
    );
    await sql.query(
      "INSERT INTO route_driver_mobile_audit(driver_id,action,details) VALUES($1,'mobile.work.completed',$2)",
      [
        driver.driver_id,
        JSON.stringify({
          executionId: route.id,
          commandId,
          completedAt: now.toISOString(),
          warehouseRequired,
          ...review.summary,
        }),
      ],
    );
    return {
      completedAt: now.toISOString(),
      summary: review.summary,
      duplicate: false,
    };
  });
}
