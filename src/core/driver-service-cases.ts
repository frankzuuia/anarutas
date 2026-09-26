import { randomUUID } from "node:crypto";
import type { Sql } from "./database";
import type { ExecutionRow, ExecutionStopRow } from "./driver-execution-read";
import { todayInTimezone } from "./local-date";
import { serviceSnapshot } from "./driver-service-context";
import type { RejectionReason } from "./driver-service-policy";

export async function driverCaseEvent(sql: Sql, incidentId: string, driverId: string,
  kind: string, now: Date, details: Record<string, unknown> = {}) {
  await sql.query(`INSERT INTO route_driver_incident_events
    (id,incident_id,kind,actor_type,actor_driver_id,occurred_at,details)
    VALUES($1,$2,$3,'driver',$4,$5,$6)`, [randomUUID(), incidentId, kind, driverId, now, JSON.stringify(details)]);
}

export async function openDriverCase(sql: Sql, route: ExecutionRow, stop: ExecutionStopRow,
  kind: "customer_closed" | "order_rejected" | "rescheduled", shipmentIds: string[],
  note: string | null, reason: RejectionReason | null, timezone: string, now: Date,
  evidenceId: string | null = null) {
  const id = randomUUID();
  await sql.query(`INSERT INTO route_driver_service_incidents
    (id,execution_id,stop_id,driver_id,kind,reason_code,note,visit_sequence,occurred_at,event_date,timezone,snapshot,evidence_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
  [id, route.id, stop.id, route.driver_id, kind, reason, note, stop.visit_sequence, now,
    todayInTimezone(timezone, now), timezone, JSON.stringify(serviceSnapshot(route, stop)), evidenceId]);
  await sql.query(`INSERT INTO route_driver_incident_orders(incident_id,execution_id,stop_id,shipment_id,open_case)
    SELECT $1,execution_id,stop_id,shipment_id,status NOT IN ('delivered','rescheduled') OR $5='rescheduled'
    FROM route_driver_execution_orders WHERE execution_id=$2 AND stop_id=$3 AND shipment_id=ANY($4::uuid[])`,
  [id, route.id, stop.id, shipmentIds, kind]);
  await driverCaseEvent(sql, id, route.driver_id, "opened", now, { shipmentIds });
  return id;
}

// Called under the execution lock. History stays immutable while case projections
// move to completed/handled once no order still needs this particular case.
export async function settleDriverCases(sql: Sql, executionId: string, shipmentIds: string[], driverId: string, now: Date) {
  const { rows } = await sql.query(`SELECT DISTINCT i.id,i.status FROM route_driver_service_incidents i
    JOIN route_driver_incident_orders io ON io.incident_id=i.id
    WHERE io.execution_id=$1 AND io.shipment_id=ANY($2::uuid[])`, [executionId, shipmentIds]);
  for (const incident of rows) {
    const summary = (await sql.query(`SELECT bool_or(io.open_case) AS open,
      bool_and(eo.status='delivered') AS delivered FROM route_driver_incident_orders io
      JOIN route_driver_execution_orders eo ON eo.execution_id=io.execution_id AND eo.shipment_id=io.shipment_id
      WHERE io.incident_id=$1`, [incident.id])).rows[0];
    if (summary.open || (!summary.delivered && incident.status !== "active")) continue;
    const status = summary.delivered ? "completed" : "handled";
    if (incident.status === status) continue;
    await sql.query(`UPDATE route_driver_service_incidents SET status=$2,terminal_at=$3,
      admin_resolved_by=NULL,version=version+1 WHERE id=$1`, [incident.id, status, now]);
    await sql.query("UPDATE route_driver_incident_evidence SET revoked_at=$2 WHERE incident_id=$1 AND revoked_at IS NULL", [incident.id, now]);
    await driverCaseEvent(sql, incident.id, driverId, status, now);
  }
}

export async function caseVisitEvent(sql: Sql, executionId: string, stopId: string,
  driverId: string, kind: "retry_arrived" | "retry_abandoned", visitSequence: number, now: Date) {
  const { rows } = await sql.query(`SELECT id FROM route_driver_service_incidents
    WHERE execution_id=$1 AND stop_id=$2 AND kind='customer_closed' AND status='active' AND visit_sequence<$3`,
  [executionId, stopId, visitSequence]);
  for (const row of rows) await driverCaseEvent(sql, row.id, driverId, kind, now, { visitSequence });
}
