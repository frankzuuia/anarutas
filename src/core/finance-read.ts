import type { Pool } from "pg";
import { transaction, assertActiveActor, type Sql } from "./database";
import { authenticateMobile } from "./driver-mobile-auth";
import {
  financeOrders,
  mobileFinanceContext,
  lockFinanceExecution,
} from "./finance-context";
import { paymentRecords } from "./payments";
import { paymentTotals } from "./payment-policy";
import type { ExecutionRow } from "./driver-execution-read";
import { settlementRecords } from "./settlements";
import { incidentFilters } from "./driver-incidents";
import { integer } from "./orders-validation";
import { AppError } from "./errors";
import { incidentFinancialDisplay } from "./incident-financial-display";
import { compareCollectionReceipts } from "./collection-receipt-order";
import { routeSettlementReview } from "./route-work-policy";
import { readRouteWork } from "./route-work";
import { settlementWarehouseRequired } from "./settlement-warehouse-policy";

export async function financeExecutionDetail(sql: Sql, route: ExecutionRow) {
  const orders = await financeOrders(sql, route),
    payments = await paymentRecords(sql, route.id),
    requests = await settlementRecords(sql, route.id),
    warehouseRequired = await settlementWarehouseRequired(sql);
  const accepted = new Set(
    requests
      .filter((r) => r.status === "accepted")
      .flatMap((r) => r.paymentIds),
  );
  const pending = new Set(
    requests.filter((r) => r.status === "pending").flatMap((r) => r.paymentIds),
  );
  return {
    route: {
      id: route.id,
      planId: route.plan_id,
      label: route.plan_label,
      driverId: route.driver_id,
      driver: route.driver_name,
      date: route.service_date,
      vehicle: route.vehicle_name,
      plate: route.vehicle_plate,
      completedAt: route.completed_at?.toISOString() ?? null,
    },
    orders: orders.map((order) => ({
      ...order,
      incidentDisplay: (() => {
        const snapshot = payments.find(
          (p) => p.shipmentId === order.shipmentId,
        )?.snapshot;
        return incidentFinancialDisplay(
          snapshot?.financial ?? order.financial,
          (snapshot?.incidents ?? order.incidents).map((i) => ({
            id: i.id,
            kind: i.kind,
            status: i.status,
            quantity: i.quantity,
            financialMoveId:
              i.financial_move_id == null ? null : Number(i.financial_move_id),
            financialSaleLineId:
              i.financial_sale_line_id == null
                ? null
                : Number(i.financial_sale_line_id),
            replacementPayment: i.replacement_payment,
          })),
        );
      })(),
      payment: payments.find((p) => p.shipmentId === order.shipmentId) ?? null,
      settlementStatus:
        payments
          .filter((p) => p.shipmentId === order.shipmentId)
          .map((p) =>
            accepted.has(p.id)
              ? "accepted"
              : pending.has(p.id)
                ? "pending"
                : "unsettled",
          )[0] ?? null,
      changedAfterPayment: payments.some(
        (p) => p.shipmentId === order.shipmentId && p.basis !== order.basis,
      ),
    })),
    totals: paymentTotals(payments),
    routeSettlement: routeSettlementReview(
      route.id,
      Boolean(route.completed_at),
      orders,
      payments,
      requests,
      warehouseRequired,
    ),
    work: await readRouteWork(
      sql,
      route.id,
      Boolean(route.completed_at),
      orders,
      payments,
      requests,
      warehouseRequired,
    ),
    requests,
    acceptedTotals: paymentTotals(payments.filter((p) => accepted.has(p.id))),
    pendingTotals: paymentTotals(payments.filter((p) => pending.has(p.id))),
    outstandingTotals: paymentTotals(
      payments.filter((p) => !accepted.has(p.id)),
    ),
  };
}
export async function readMobileFinanceDetail(
  pool: Pool,
  authorization: string | null,
  executionId: string,
) {
  return transaction(pool, async (sql) => {
    const { route } = await mobileFinanceContext(
      sql,
      authorization,
      executionId,
    );
    return financeExecutionDetail(sql, route);
  });
}
export async function listMobileFinance(
  pool: Pool,
  authorization: string | null,
  page = 0,
) {
  integer(page, 0);
  return transaction(pool, async (sql) => {
    const driver = await authenticateMobile(sql, authorization, true);
    return (
      await sql.query(
        `SELECT e.id,e.plan_label AS label,e.service_date::text AS date,e.driver_name AS driver,e.vehicle_name AS vehicle,c.completed_at AS "completedAt",
      (SELECT count(*)::int FROM route_driver_execution_orders o WHERE o.execution_id=e.id AND o.status='delivered') AS delivered,
      (SELECT count(*)::int FROM route_order_payments p WHERE p.execution_id=e.id) AS payments
      FROM route_driver_executions e LEFT JOIN route_driver_execution_completions c ON c.execution_id=e.id
      WHERE e.driver_id=$1 ORDER BY e.service_date DESC,e.started_at DESC,e.id LIMIT 50 OFFSET $2`,
        [driver.driver_id, page * 50],
      )
    ).rows;
  });
}
export async function readSettlementDetail(
  pool: Pool,
  actor: string,
  executionId: string,
) {
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor, "settlement");
    const route = await lockFinanceExecution(sql, executionId);
    const detail = await financeExecutionDetail(sql, route);
    return {
      ...detail,
      orders: detail.orders
        .filter((order) => order.payment !== null)
        .sort((left, right) =>
          compareCollectionReceipts(left.payment!, right.payment!),
        ),
    };
  });
}
export async function listSettlements(
  pool: Pool,
  actor: string,
  params: URLSearchParams,
  timezone: string,
) {
  const filter = incidentFilters(params, timezone),
    page = integer(Number(params.get("page") ?? 0), 0);
  const dateBasis = params.get("dateBasis") ?? "route";
  if (dateBasis !== "route" && dateBasis !== "receipt")
    throw new AppError("INVALID_INPUT");
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor, "settlement");
    const args = [filter.from, filter.to, filter.driverId, timezone];
    const receiptPeriod = `(r.decided_at AT TIME ZONE $4)::date BETWEEN $1::date AND $2::date`;
    const dates =
      dateBasis === "route"
        ? `e.service_date BETWEEN $1::date AND $2::date`
        : `EXISTS(SELECT 1 FROM route_settlement_requests r WHERE r.execution_id=e.id AND r.status='accepted' AND ${receiptPeriod})`;
    const condition = `${dates} AND ($3::uuid IS NULL OR e.driver_id=$3) AND (EXISTS(SELECT 1 FROM route_order_payments p WHERE p.execution_id=e.id)
      OR EXISTS(SELECT 1 FROM route_driver_execution_completions c WHERE c.execution_id=e.id)) AND $4::text IS NOT NULL`;
    const rows = (
      await sql.query(
        `SELECT e.id,e.plan_label AS label,e.service_date::text AS date,e.driver_id AS "driverId",e.driver_name AS driver,e.vehicle_name AS vehicle,
    (SELECT completed_at FROM route_driver_execution_completions WHERE execution_id=e.id) AS "completedAt",
    (SELECT count(*)::int FROM route_settlement_requests WHERE execution_id=e.id AND status='pending') AS pending,
    (SELECT count(*)::int FROM route_order_payments WHERE execution_id=e.id) AS payments,
    (SELECT count(*)::int FROM route_driver_execution_orders WHERE execution_id=e.id AND status='delivered') AS delivered
    FROM route_driver_executions e WHERE ${condition} ORDER BY e.driver_name,e.driver_id,e.service_date DESC,e.id LIMIT 51 OFFSET $5`,
        [...args, page * 50],
      )
    ).rows;
    const metrics = (
      await sql.query(
        `WITH entries AS (
     SELECT p.*,'collected'::text AS stage FROM route_order_payments p JOIN route_driver_executions e ON e.id=p.execution_id WHERE ${condition} AND ${dateBasis === "route" ? "true" : "false"}
     UNION ALL SELECT p.*,r.status AS stage FROM route_order_payments p JOIN route_driver_executions e ON e.id=p.execution_id
       JOIN route_settlement_claims c ON c.payment_id=p.id JOIN route_settlement_requests r ON r.id=c.request_id WHERE ${condition}
       ${dateBasis === "receipt" ? `AND r.status='accepted' AND ${receiptPeriod}` : ""}
   ) SELECT stage,currency,COALESCE(sum(cash_received),0)::text AS cash,
    COALESCE(sum(transfer_received),0)::text AS transfer,
    COALESCE(sum(expected) FILTER(WHERE method='credit'),0)::text AS credit,
    COALESCE(sum(balance) FILTER(WHERE method<>'credit'),0)::text AS balance,COALESCE(sum(deferred),0)::text AS deferred
    FROM entries GROUP BY stage,currency ORDER BY stage,currency->>'name'`,
        args,
      )
    ).rows;
    return {
      rows: rows.slice(0, 50),
      hasMore: rows.length > 50,
      page,
      metrics,
      from: filter.from,
      to: filter.to,
      dateBasis,
    };
  });
}
