import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction } from "./database";
import { integer, uuid } from "./orders-validation";
import { AppError } from "./errors";
import { serviceAction, serviceTransition, type DriverOrderStatus } from "./driver-service-policy";
import { lockServiceContext, serviceIdentity, serviceSnapshot } from "./driver-service-context";
import { openDriverCase, settleDriverCases } from "./driver-service-cases";
import { saveDriverCommandReceipt } from "./driver-command-receipts";
import { todayInTimezone } from "./local-date";

export async function executeDriverOrderCommand(pool: Pool, authorization: string | null, planId: string,
  stopId: string, shipmentId: string, raw: Record<string, unknown>, timezone: string, at?: Date) {
  const input = serviceIdentity(raw), action = serviceAction(raw);
  const shipment = uuid(shipmentId), version = integer(raw.orderVersion, 1);
  return transaction(pool, async sql => {
    const { previous, driver, route, hash, stop } = await lockServiceContext(sql, authorization, planId, stopId,
      input, { shipment, version, ...action });
    if (previous) return previous;
    const order = (await sql.query<{ status: DriverOrderStatus; version: number }>(
      "SELECT status,version FROM route_driver_execution_orders WHERE execution_id=$1 AND stop_id=$2 AND shipment_id=$3 FOR UPDATE",
      [route.id, stop!.id, shipment])).rows[0];
    if (!order) throw new AppError("NOT_FOUND", 404);
    if (order.version !== version) throw new AppError("VERSION_CONFLICT", 409);
    if (action.kind !== "reschedule" && order.status === "closed_pending") {
      const closedHere = await sql.query(`SELECT 1 FROM route_driver_service_incidents i
        JOIN route_driver_incident_orders io ON io.incident_id=i.id
        WHERE i.execution_id=$1 AND i.stop_id=$2 AND i.kind='customer_closed'
          AND i.visit_sequence=$3 AND io.shipment_id=$4 AND io.open_case`,
      [route.id, stop!.id, stop!.visit_sequence, shipment]);
      if (closedHere.rowCount) throw new AppError("RETRY_REQUIRES_NEW_ARRIVAL", 409);
    }
    const status = serviceTransition(order.status, action.kind), now = at ?? new Date();
    await sql.query(`UPDATE route_driver_execution_orders SET status=$3,version=version+1,updated_at=$4
      WHERE execution_id=$1 AND shipment_id=$2`, [route.id, shipment, status, now]);
    await sql.query(`UPDATE route_driver_incident_orders SET open_case=false
      WHERE execution_id=$1 AND shipment_id=$2 AND open_case`, [route.id, shipment]);
    await settleDriverCases(sql, route.id, [shipment], driver.driver_id, now);
    const incidentId = action.kind === "deliver" ? null : await openDriverCase(sql, route, stop!,
      action.kind === "reject" ? "order_rejected" : "rescheduled", [shipment], action.note, action.reason, timezone, now);
    const eventId = randomUUID();
    await sql.query(`INSERT INTO route_driver_stop_events
      (id,execution_id,stop_id,driver_id,device_id,kind,occurred_at,event_date,timezone,details,visit_sequence)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [eventId, route.id, stop!.id, driver.driver_id, driver.device_id,
      { deliver: "delivery", reject: "rejection", reschedule: "reschedule" }[action.kind], now,
      todayInTimezone(timezone, now), timezone, JSON.stringify({ ...serviceSnapshot(route, stop!),
        shipmentId: shipment, before: order.status, status, incidentId }), stop!.visit_sequence]);
    await sql.query("UPDATE route_driver_execution_stops SET version=version+1 WHERE id=$1", [stop!.id]);
    await sql.query("UPDATE route_driver_executions SET revision=revision+1 WHERE id=$1", [route.id]);
    await sql.query("INSERT INTO route_driver_mobile_audit(driver_id,action,details) VALUES($1,$2,$3)",
      [driver.driver_id, `mobile.order.${status}`, JSON.stringify({ executionId: route.id, stopId: stop!.id,
        shipmentId: shipment, eventId, incidentId, deviceId: driver.device_id })]);
    return saveDriverCommandReceipt(sql, driver.device_id, input.commandId, hash, route.id,
      { eventId, incidentId, occurredAt: now.toISOString(), executionRevision: route.revision + 1, duplicate: false });
  });
}
