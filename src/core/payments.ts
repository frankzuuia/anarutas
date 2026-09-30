import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction, type Sql } from "./database";
import { uuid } from "./orders-validation";
import { AppError } from "./errors";
import { financialHash } from "./financial-policy";
import {
  paymentInput,
  calculatePayment,
  type PaymentAmounts,
  type PaymentMethod,
} from "./payment-policy";
import type { FinancialCurrency } from "./financial-contract";
import { mobileFinanceContext, financeOrders } from "./finance-context";
import { todayInTimezone } from "./local-date";

export type PaymentRecord = PaymentAmounts & {
  id: string;
  executionId: string;
  shipmentId: string;
  driverId: string;
  method: PaymentMethod;
  currency: FinancialCurrency;
  note: string;
  basis: string;
  recordedAt: string;
  snapshot: Awaited<ReturnType<typeof financeOrders>>[number];
};
export async function paymentRecords(
  sql: Sql,
  executionId: string,
): Promise<PaymentRecord[]> {
  const rows = (
    await sql.query(
      "SELECT * FROM route_order_payments WHERE execution_id=$1 ORDER BY recorded_at,id",
      [executionId],
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    executionId: row.execution_id,
    shipmentId: row.shipment_id,
    driverId: row.driver_id,
    method: row.method,
    currency: row.currency,
    expected: row.expected,
    tendered: row.tendered,
    change: row.change,
    received: row.received,
    balance: row.balance,
    deferred: row.deferred,
    note: row.note,
    basis: row.basis,
    recordedAt: row.recorded_at.toISOString(),
    snapshot: row.snapshot,
  }));
}
export async function confirmOrderPayment(
  pool: Pool,
  authorization: string | null,
  executionId: string,
  raw: Record<string, unknown>,
  timezone: string,
  now = new Date(),
) {
  const commandId = uuid(raw.commandId),
    shipmentId = uuid(raw.shipmentId),
    input = paymentInput(raw);
  const hash = financialHash({ executionId, shipmentId, input });
  return transaction(pool, async (sql) => {
    const { driver, route } = await mobileFinanceContext(
      sql,
      authorization,
      executionId,
    );
    const previous = (
      await sql.query(
        "SELECT id,request_hash FROM route_order_payments WHERE device_id=$1 AND command_id=$2",
        [driver.device_id, commandId],
      )
    ).rows[0];
    if (previous) {
      if (previous.request_hash !== hash)
        throw new AppError("COMMAND_REUSED", 409);
      return { id: previous.id, duplicate: true };
    }
    await sql.query(
      "SELECT shipment_id FROM route_driver_execution_orders WHERE execution_id=$1 AND shipment_id=$2 FOR UPDATE",
      [route.id, shipmentId],
    );
    if (
      (
        await sql.query(
          "SELECT id FROM route_order_payments WHERE execution_id=$1 AND shipment_id=$2",
          [route.id, shipmentId],
        )
      ).rowCount
    )
      throw new AppError("PAYMENT_ALREADY_CONFIRMED", 409);
    await sql.query(
      `SELECT t.source FROM route_financial_targets t JOIN route_shipments s ON (s.source,s.picking_id,s.order_id)=(t.source,t.picking_id,t.order_id)
      WHERE s.id=$1 FOR SHARE OF t`,
      [shipmentId],
    );
    const detail = (await financeOrders(sql, route, now)).find(
      (order) => order.shipmentId === shipmentId,
    );
    if (!detail) throw new AppError("NOT_FOUND", 404);
    if (detail.status !== "delivered")
      throw new AppError("PAYMENT_DELIVERY_REQUIRED", 409);
    if (detail.basis !== input.basis)
      throw new AppError("PAYMENT_BASIS_CHANGED", 409);
    if (!detail.financial)
      throw new AppError("FINANCIAL_SOURCE_NOT_READY", 409);
    const amounts = calculatePayment(detail.financial, input),
      id = randomUUID();
    await sql.query(
      `INSERT INTO route_order_payments(id,execution_id,shipment_id,driver_id,device_id,command_id,request_hash,method,currency,
      expected,tendered,change,received,balance,deferred,note,basis,snapshot,recorded_at,payment_date,timezone)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        id,
        route.id,
        shipmentId,
        driver.driver_id,
        driver.device_id,
        commandId,
        hash,
        input.method,
        JSON.stringify(detail.financial.currency),
        amounts.expected,
        amounts.tendered,
        amounts.change,
        amounts.received,
        amounts.balance,
        amounts.deferred,
        input.note,
        detail.basis,
        JSON.stringify(detail),
        now,
        todayInTimezone(timezone, now),
        timezone,
      ],
    );
    await sql.query(
      "INSERT INTO route_driver_mobile_audit(driver_id,action,details) VALUES($1,'mobile.payment.confirmed',$2)",
      [
        driver.driver_id,
        JSON.stringify({
          id,
          executionId: route.id,
          shipmentId,
          deviceId: driver.device_id,
        }),
      ],
    );
    return { id, duplicate: false };
  });
}
