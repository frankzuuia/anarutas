import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction, assertActiveActor, audit, type Sql } from "./database";
import { uuid, integer } from "./orders-validation";
import { AppError } from "./errors";
import { financialHash } from "./financial-policy";
import { paymentTotals } from "./payment-policy";
import { paymentRecords } from "./payments";
import { lockFinanceExecution, mobileFinanceContext } from "./finance-context";
import { financeOrders } from "./finance-context";
import {
  routeSettlementReview,
  settlementRouteReady,
} from "./route-work-policy";
import { settlementWarehouseRequired } from "./settlement-warehouse-policy";

export async function settlementRecords(sql: Sql, executionId: string) {
  const rows = (
    await sql.query(
      `SELECT r.*,u.name AS receiver,ARRAY(SELECT payment_id FROM route_settlement_items WHERE request_id=r.id ORDER BY payment_id) AS payment_ids
 FROM route_settlement_requests r LEFT JOIN route_users u ON u.id=r.decided_by WHERE execution_id=$1 ORDER BY requested_at DESC,id`,
      [executionId],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id as string,
    status: r.status as "pending" | "accepted" | "rejected",
    version: r.version as number,
    scope: r.scope as "order" | "route",
    requestedAt: r.requested_at.toISOString() as string,
    decidedAt: r.decided_at?.toISOString() ?? null,
    receiver: r.receiver as string | null,
    note: r.decision_note as string | null,
    paymentIds: r.payment_ids as string[],
    totals: r.snapshot.totals as ReturnType<typeof paymentTotals>,
    basis: financialHash(r.snapshot),
  }));
}
export async function requestSettlement(
  pool: Pool,
  authorization: string | null,
  executionId: string,
  raw: Record<string, unknown>,
  now = new Date(),
) {
  const commandId = uuid(raw.commandId),
    shipmentId = raw.shipmentId === null ? null : uuid(raw.shipmentId);
  if (
    raw.basis !== undefined &&
    (shipmentId !== null ||
      typeof raw.basis !== "string" ||
      raw.basis.length !== 64)
  )
    throw new AppError("SETTLEMENT_REVIEW_REQUIRED");
  const hash = financialHash({
    executionId,
    shipmentId,
    ...(raw.basis === undefined ? {} : { basis: raw.basis }),
  });
  return transaction(pool, async (sql) => {
    const { driver, route } = await mobileFinanceContext(
      sql,
      authorization,
      executionId,
    );
    const prior = (
      await sql.query(
        "SELECT id,request_hash FROM route_settlement_requests WHERE device_id=$1 AND command_id=$2",
        [driver.device_id, commandId],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash)
        throw new AppError("COMMAND_REUSED", 409);
      return { id: prior.id, duplicate: true };
    }
    const warehouseRequired = await settlementWarehouseRequired(sql);
    const orders = shipmentId === null ? await financeOrders(sql, route) : [];
    if (
      shipmentId === null &&
      !settlementRouteReady(
        Boolean(route.completed_at),
        warehouseRequired,
        orders,
      )
    )
      throw new AppError(
        warehouseRequired
          ? "SETTLEMENT_ROUTE_NOT_FINISHED"
          : "SETTLEMENT_ORDERS_NOT_DELIVERED",
        409,
      );
    const all = await paymentRecords(sql, route.id),
      requests = await settlementRecords(sql, route.id);
    if (raw.basis !== undefined) {
      const review = routeSettlementReview(
        route.id,
        Boolean(route.completed_at),
        orders,
        all,
        requests,
        warehouseRequired,
      );
      if (review.basis !== raw.basis)
        throw new AppError("SETTLEMENT_VERSION_CHANGED", 409);
    }
    const accepted = new Set(
      requests
        .filter((r) => r.status === "accepted")
        .flatMap((r) => r.paymentIds),
    );
    const pending = new Set(
      requests
        .filter((r) => r.status === "pending")
        .flatMap((r) => r.paymentIds),
    );
    const selected = all.filter(
      (p) =>
        (shipmentId === null || p.shipmentId === shipmentId) &&
        !accepted.has(p.id),
    );
    if (shipmentId === null) {
      const missing = await sql.query(
        `SELECT 1 FROM route_driver_execution_orders o WHERE o.execution_id=$1 AND o.status='delivered'
       AND NOT EXISTS(SELECT 1 FROM route_order_payments p WHERE p.execution_id=o.execution_id AND p.shipment_id=o.shipment_id)`,
        [route.id],
      );
      if (missing.rowCount)
        throw new AppError("SETTLEMENT_PAYMENTS_MISSING", 409);
    }
    if (!selected.length) throw new AppError("SETTLEMENT_NOTHING_PENDING", 409);
    if (selected.some((p) => pending.has(p.id)))
      throw new AppError("SETTLEMENT_REQUEST_PENDING", 409);
    const id = randomUUID(),
      snapshot = {
        paymentIds: selected.map((p) => p.id).sort(),
        totals: paymentTotals(selected),
        warehouseRequired,
      };
    await sql.query(
      `INSERT INTO route_settlement_requests(id,execution_id,driver_id,device_id,command_id,request_hash,scope,snapshot,requested_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        route.id,
        driver.driver_id,
        driver.device_id,
        commandId,
        hash,
        shipmentId === null ? "route" : "order",
        JSON.stringify(snapshot),
        now,
      ],
    );
    for (const payment of selected) {
      await sql.query(
        "INSERT INTO route_settlement_items(request_id,payment_id) VALUES($1,$2)",
        [id, payment.id],
      );
      await sql.query(
        "INSERT INTO route_settlement_claims(request_id,payment_id) VALUES($1,$2)",
        [id, payment.id],
      );
    }
    await sql.query(
      "INSERT INTO route_driver_mobile_audit(driver_id,action,details) VALUES($1,'mobile.settlement.requested',$2)",
      [
        driver.driver_id,
        JSON.stringify({ id, executionId: route.id, ...snapshot }),
      ],
    );
    return { id, duplicate: false };
  });
}
export async function decideSettlement(
  pool: Pool,
  actor: string,
  requestId: string,
  raw: Record<string, unknown>,
  now = new Date(),
) {
  const id = uuid(requestId),
    commandId = uuid(raw.commandId),
    version = integer(raw.version, 1);
  if (raw.decision !== "accepted" && raw.decision !== "rejected")
    throw new AppError("SETTLEMENT_DECISION_INVALID");
  if (
    typeof raw.note !== "string" ||
    raw.note.length > 2000 ||
    typeof raw.basis !== "string"
  )
    throw new AppError("INVALID_INPUT");
  const note = raw.note.trim();
  const hash = financialHash({
    id,
    version,
    decision: raw.decision,
    note: raw.note,
    basis: raw.basis,
  });
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor, "settlement");
    const identity = (
      await sql.query(
        "SELECT execution_id FROM route_settlement_requests WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!identity) throw new AppError("NOT_FOUND", 404);
    await lockFinanceExecution(sql, identity.execution_id);
    const row = (
      await sql.query(
        "SELECT * FROM route_settlement_requests WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (row.decided_by === actor && row.decision_command === commandId) {
      if (row.decision_hash !== hash) throw new AppError("COMMAND_REUSED", 409);
      return { id, status: row.status, duplicate: true };
    }
    if (row.version !== version || row.status !== "pending")
      throw new AppError("SETTLEMENT_VERSION_CHANGED", 409);
    if (financialHash(row.snapshot) !== raw.basis)
      throw new AppError("SETTLEMENT_VERSION_CHANGED", 409);
    await sql.query(
      `UPDATE route_settlement_requests SET status=$2,version=version+1,decided_at=$3,decided_by=$4,decision_note=$5,decision_command=$6,decision_hash=$7 WHERE id=$1`,
      [id, raw.decision, now, actor, note, commandId, hash],
    );
    if (raw.decision === "rejected")
      await sql.query(
        "DELETE FROM route_settlement_claims WHERE request_id=$1",
        [id],
      );
    await audit(sql, actor, `settlement.${raw.decision}`, id, {
      executionId: identity.execution_id,
      totals: row.snapshot.totals,
    });
    return { id, status: raw.decision, duplicate: false };
  });
}
