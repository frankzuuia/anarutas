import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction } from "./database";
import { authenticateMobile } from "./driver-mobile-auth";
import { AppError } from "./errors";
import { serviceNote } from "./driver-service-policy";
import { lockServiceContext, serviceIdentity, serviceSnapshot } from "./driver-service-context";
import { openDriverCase, settleDriverCases } from "./driver-service-cases";
import { saveDriverCommandReceipt } from "./driver-command-receipts";
import { storeIncidentEvidence } from "./driver-incident-evidence";
import { todayInTimezone } from "./local-date";

export async function reportCustomerClosed(pool: Pool, authorization: string | null, planId: string,
  stopId: string, raw: Record<string, unknown>, bytes: Buffer, contentType: string, timezone: string,
  configuredRoot?: string, at?: Date) {
  const input = serviceIdentity(raw), note = serviceNote(raw.note);
  // Reject unauthenticated requests before spending CPU or writing private files.
  await authenticateMobile(pool, authorization);
  const evidence = await storeIncidentEvidence(bytes, contentType, configuredRoot);
  let kept = false;
  try {
    const result = await transaction(pool, async sql => {
      const { previous, driver, route, hash, stop } = await lockServiceContext(sql, authorization, planId, stopId,
        input, { kind: "customer_closed", note, contentHash: evidence.hash });
      if (previous) return previous;
      const orders = (await sql.query(`SELECT shipment_id,status FROM route_driver_execution_orders
        WHERE execution_id=$1 AND stop_id=$2 ORDER BY shipment_id FOR UPDATE`, [route.id, stop!.id])).rows;
      const pending = orders.filter(order => order.status !== "delivered" && order.status !== "rescheduled");
      if (!pending.length) throw new AppError("ORDER_STATE_CONFLICT", 409);
      const currentCase = await sql.query(`SELECT 1 FROM route_driver_service_incidents
        WHERE execution_id=$1 AND stop_id=$2 AND kind='customer_closed' AND visit_sequence=$3`,
      [route.id, stop!.id, stop!.visit_sequence]);
      if (currentCase.rowCount) throw new AppError("RETRY_REQUIRES_NEW_ARRIVAL", 409);
      const ids = pending.map(order => order.shipment_id);
      await sql.query(`UPDATE route_driver_execution_orders SET status='closed_pending',version=version+1,updated_at=$3
        WHERE execution_id=$1 AND shipment_id=ANY($2::uuid[])`, [route.id, ids, at ?? new Date()]);
      await sql.query(`UPDATE route_driver_incident_orders SET open_case=false
        WHERE execution_id=$1 AND shipment_id=ANY($2::uuid[]) AND open_case`, [route.id, ids]);
      const now = at ?? new Date();
      await settleDriverCases(sql, route.id, ids, driver.driver_id, now);
      const incidentId = await openDriverCase(sql, route, stop!, "customer_closed", orders.map(order => order.shipment_id),
        note, null, timezone, now, evidence.id);
      await sql.query(`INSERT INTO route_driver_incident_evidence
        (id,incident_id,storage_key,content_hash,bytes,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6::timestamptz,$6::timestamptz+interval '24 hours')`,
      [evidence.id, incidentId, evidence.storageKey, evidence.hash, evidence.bytes, now]);
      const eventId = randomUUID();
      await sql.query(`INSERT INTO route_driver_stop_events
        (id,execution_id,stop_id,driver_id,device_id,kind,occurred_at,event_date,timezone,details,visit_sequence)
        VALUES($1,$2,$3,$4,$5,'customer_closed',$6,$7,$8,$9,$10)`,
      [eventId, route.id, stop!.id, driver.driver_id, driver.device_id, now, todayInTimezone(timezone, now), timezone,
        JSON.stringify({ ...serviceSnapshot(route, stop!), incidentId, shipmentIds: ids }), stop!.visit_sequence]);
      await sql.query("UPDATE route_driver_execution_stops SET version=version+1 WHERE id=$1", [stop!.id]);
      await sql.query("UPDATE route_driver_executions SET revision=revision+1 WHERE id=$1", [route.id]);
      await sql.query("INSERT INTO route_driver_mobile_audit(driver_id,action,details) VALUES($1,'mobile.customer.closed',$2)",
        [driver.driver_id, JSON.stringify({ executionId: route.id, stopId: stop!.id, incidentId, eventId, deviceId: driver.device_id })]);
      return saveDriverCommandReceipt(sql, driver.device_id, input.commandId, hash, route.id,
        { eventId, incidentId, occurredAt: now.toISOString(), executionRevision: route.revision + 1, duplicate: false });
    });
    kept = !result.duplicate;
    return result;
  } finally { if (!kept) await evidence.discard(); }
}
