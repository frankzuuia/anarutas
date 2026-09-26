import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertActiveActor, audit, transaction } from "./database";
import { incidentFilters } from "./driver-incidents";
import { integer, uuid } from "./orders-validation";
import { AppError } from "./errors";

export type LiveIncident = {
  id: string; kind: "customer_closed" | "order_rejected" | "rescheduled";
  status: "active" | "completed" | "handled" | "resolved_by_admin";
  reasonCode: "poor_quality" | "late_arrival" | "other" | null; note: string | null;
  occurredAt: string; timezone: string; driverId: string; version: number;
  snapshot: { driver: string; customer: string; vehicle: string; plate: string; planLabel: string; address: string };
  orders: string[]; evidenceId: string | null; evidenceExpiresAt: string | null;
  canResolve: boolean;
};
export type LiveIncidentReport = { rows: LiveIncident[]; nextCursor: string | null;
  metrics: { pending: number; completed: number; resolved: number }; drivers: { id: string; name: string }[] };

// A retry disappears from the live feed only after a new verified arrival. If
// the driver leaves without service the same case becomes visible again.
const visibleCases = `FROM route_driver_service_incidents i
  JOIN route_driver_execution_stops s ON s.execution_id=i.execution_id AND s.id=i.stop_id
  WHERE i.event_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR i.driver_id=$3)
    AND i.status<>'handled'
    AND NOT(i.kind='customer_closed' AND i.status='active' AND s.visit_state='arrived' AND s.visit_sequence>i.visit_sequence)`;

export async function readLiveIncidents(pool: Pool, actorId: string, params: URLSearchParams,
  timezone: string, now = new Date()): Promise<LiveIncidentReport> {
  const filters = incidentFilters(params, timezone);
  return transaction(pool, async sql => {
    await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await assertActiveActor(sql, actorId);
    // One consistent cut for rows and metrics; no all-driver count under a driver filter.
    const values = [filters.from, filters.to, filters.driverId];
    const { rows } = await sql.query(`SELECT i.*,
      to_char(i.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,
      (SELECT jsonb_agg(s.order_names[array_position(s.shipment_ids,io.shipment_id)] ORDER BY array_position(s.shipment_ids,io.shipment_id))
        FROM route_driver_incident_orders io WHERE io.incident_id=i.id) AS order_names,
      (SELECT e.id FROM route_driver_incident_evidence e WHERE e.id=i.evidence_id AND e.expires_at>$6
        AND e.revoked_at IS NULL AND e.removed_at IS NULL) AS available_evidence_id,
      (SELECT e.expires_at FROM route_driver_incident_evidence e WHERE e.id=i.evidence_id) AS evidence_expires_at
      ${visibleCases} AND ($4::timestamptz IS NULL OR (i.occurred_at,i.id)<($4::timestamptz,$5::uuid))
      ORDER BY i.occurred_at DESC,i.id DESC LIMIT 51`,
    [...values, filters.cursor?.time ?? null, filters.cursor?.id ?? null, now]);
    const metrics = (await sql.query(`SELECT count(*) FILTER(WHERE i.status='active')::int AS pending,
      count(*) FILTER(WHERE i.status='completed')::int AS completed,
      count(*) FILTER(WHERE i.status='resolved_by_admin')::int AS resolved ${visibleCases}`, values)).rows[0];
    const drivers = (await sql.query(`SELECT d.id,d.name FROM route_drivers d WHERE d.active OR EXISTS
      (SELECT 1 FROM route_driver_service_incidents i WHERE i.driver_id=d.id) ORDER BY d.name,d.id`)).rows;
    const page = rows.slice(0, 50), last = page.at(-1);
    return { metrics, drivers, rows: page.map(row => ({
      id: row.id, kind: row.kind, status: row.status, reasonCode: row.reason_code, note: row.note,
      occurredAt: row.occurred_at.toISOString(), timezone: row.timezone, driverId: row.driver_id, version: row.version,
      snapshot: row.snapshot, orders: row.order_names, evidenceId: row.available_evidence_id,
      evidenceExpiresAt: row.evidence_expires_at?.toISOString() ?? null,
      canResolve: row.status === "active" && row.kind !== "customer_closed",
    })), nextCursor: rows.length > 50 ? Buffer.from(JSON.stringify({ filterHash: filters.filterHash,
      time: last.cursor_time, id: last.id })).toString("base64url") : null };
  });
}

export async function resolveLiveIncident(pool: Pool, actorId: string, incidentId: string,
  raw: Record<string, unknown>, at?: Date) {
  const id = uuid(incidentId), version = integer(raw.expectedVersion, 1);
  return transaction(pool, async sql => {
    await assertActiveActor(sql, actorId);
    const target = (await sql.query("SELECT execution_id FROM route_driver_service_incidents WHERE id=$1", [id])).rows[0];
    if (!target) throw new AppError("NOT_FOUND", 404);
    // Same lock order as mobile commands: execution before case/order projection.
    await sql.query("SELECT id FROM route_driver_executions WHERE id=$1 FOR UPDATE", [target.execution_id]);
    const row = (await sql.query("SELECT * FROM route_driver_service_incidents WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (row.kind === "customer_closed") throw new AppError("DRIVER_RETRY_REQUIRED", 409);
    if (row.status === "resolved_by_admin") return { resolved: true, duplicate: true };
    if (row.version !== version || row.status !== "active") throw new AppError("VERSION_CONFLICT", 409);
    const now = at ?? new Date();
    await sql.query(`UPDATE route_driver_service_incidents SET status='resolved_by_admin',terminal_at=$2,
      admin_resolved_by=$3,version=version+1 WHERE id=$1`, [id, now, actorId]);
    await sql.query("UPDATE route_driver_incident_orders SET open_case=false WHERE incident_id=$1", [id]);
    await sql.query("UPDATE route_driver_incident_evidence SET revoked_at=$2 WHERE incident_id=$1 AND revoked_at IS NULL", [id, now]);
    await sql.query(`INSERT INTO route_driver_incident_events(id,incident_id,kind,actor_type,actor_admin_id,occurred_at)
      VALUES($1,$2,'resolved_by_admin','admin',$3,$4)`, [randomUUID(), id, actorId, now]);
    await audit(sql, actorId, "driver.incident.resolved", id, { executionId: target.execution_id });
    return { resolved: true, duplicate: false };
  });
}
