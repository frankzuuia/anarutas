import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction } from "./database";
import { authenticateMobile } from "./driver-mobile-auth";
import { executableRoute, type ExecutionStopRow } from "./driver-execution-read";
import { driverCommandReceipt, saveDriverCommandReceipt } from "./driver-command-receipts";
import { serviceIdentity, serviceSnapshot } from "./driver-service-context";
import { retryOrderTransition, type DriverOrderStatus } from "./driver-service-policy";
import { driverCaseEvent, settleDriverCases } from "./driver-service-cases";
import { recordVisitExit } from "./driver-stop-command";
import { integer, uuid } from "./orders-validation";
import { todayInTimezone } from "./local-date";
import { AppError } from "./errors";

// Unlike serving, reopening does not claim physical arrival. Every old visit is
// invalidated atomically, so a new GPS-verified arrival is necessary to deliver.
export async function retryDriverOrder(pool: Pool, authorization: string | null, planId: string,
  stopId: string, shipmentId: string, raw: Record<string, unknown>, timezone: string, at?: Date) {
  const input = serviceIdentity(raw), plan = uuid(planId), stopKey = uuid(stopId);
  const shipment = uuid(shipmentId), orderVersion = integer(raw.orderVersion, 1);
  const hash = createHash("sha256").update(JSON.stringify({ plan, stopKey, shipment, orderVersion, input, kind: "order_retry" })).digest("hex");
  return transaction(pool, async sql => {
    const driver = await authenticateMobile(sql, authorization, true);
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`driver-command:${driver.device_id}:${input.commandId}`]);
    const route = await executableRoute(sql, driver.driver_id, plan, true);
    if (route.id !== input.executionId || route.publication_revision !== input.publicationRevision)
      throw new AppError("VERSION_CONFLICT", 409);
    const previous = await driverCommandReceipt(sql, driver.device_id, input.commandId, hash);
    if (previous) return previous;
    const stop = (await sql.query<ExecutionStopRow>(
      "SELECT * FROM route_driver_execution_stops WHERE id=$1 AND execution_id=$2 FOR UPDATE", [stopKey, route.id])).rows[0];
    if (!stop) throw new AppError("NOT_FOUND", 404);
    if (route.revision !== input.executionRevision || stop.version !== input.stopVersion || stop.visit_sequence !== input.visitSequence)
      throw new AppError("VERSION_CONFLICT", 409);
    const order = (await sql.query<{ status: DriverOrderStatus; version: number }>(
      "SELECT status,version FROM route_driver_execution_orders WHERE execution_id=$1 AND stop_id=$2 AND shipment_id=$3 FOR UPDATE",
      [route.id, stop.id, shipment])).rows[0];
    if (!order) throw new AppError("NOT_FOUND", 404);
    if (order.version !== orderVersion) throw new AppError("VERSION_CONFLICT", 409);
    const status = retryOrderTransition(order.status), now = at ?? new Date();
    if (stop.visit_state === "arrived")
      await recordVisitExit(sql, route, stop, driver.driver_id, driver.device_id, now, timezone, "order_reopened");
    await sql.query(`UPDATE route_driver_execution_orders SET status=$3,version=version+1,updated_at=$4
      WHERE execution_id=$1 AND shipment_id=$2`, [route.id, shipment, status, now]);
    await sql.query(`UPDATE route_driver_incident_orders SET open_case=false
      WHERE execution_id=$1 AND shipment_id=$2 AND open_case`, [route.id, shipment]);
    const cases = (await sql.query(`SELECT DISTINCT i.id FROM route_driver_service_incidents i
      JOIN route_driver_incident_orders io ON io.incident_id=i.id
      WHERE i.execution_id=$1 AND io.shipment_id=$2 AND i.kind='rescheduled'`, [route.id, shipment])).rows;
    for (const row of cases) await driverCaseEvent(sql, row.id, driver.driver_id, "reopened", now, { shipmentId: shipment });
    await settleDriverCases(sql, route.id, [shipment], driver.driver_id, now);
    const eventId = randomUUID();
    await sql.query(`INSERT INTO route_driver_stop_events
      (id,execution_id,stop_id,driver_id,device_id,kind,occurred_at,event_date,timezone,details,visit_sequence)
      VALUES($1,$2,$3,$4,$5,'order_reopened',$6,$7,$8,$9,$10)`,
    [eventId, route.id, stop.id, driver.driver_id, driver.device_id, now, todayInTimezone(timezone, now), timezone,
      JSON.stringify({ ...serviceSnapshot(route, stop), shipmentId: shipment, before: order.status, status }), stop.visit_sequence]);
    await sql.query("UPDATE route_driver_execution_stops SET version=version+1 WHERE id=$1", [stop.id]);
    await sql.query("UPDATE route_driver_executions SET revision=revision+1 WHERE id=$1", [route.id]);
    await sql.query("INSERT INTO route_driver_mobile_audit(driver_id,action,details) VALUES($1,'mobile.order.reopened',$2)",
      [driver.driver_id, JSON.stringify({ executionId: route.id, stopId: stop.id, shipmentId: shipment, eventId, deviceId: driver.device_id })]);
    return saveDriverCommandReceipt(sql, driver.device_id, input.commandId, hash, route.id,
      { eventId, occurredAt: now.toISOString(), executionRevision: route.revision + 1, duplicate: false });
  });
}
