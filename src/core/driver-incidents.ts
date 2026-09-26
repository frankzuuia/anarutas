import { createHash } from "node:crypto";
import type { Sql } from "./database";
import { serviceDate } from "./plans";
import { uuid } from "./orders-validation";
import { AppError } from "./errors";
import { todayInTimezone } from "./local-date";

export type DriverIncident = {
  id: string; kind: "location_corrected" | "late_arrival"; occurredAt: string;
  date: string; timezone: string; driverId: string;
  details: { driver: string; customer: string; vehicle: string; plate: string; address: string;
    previousAddress?: string; correctedAddress?: string;
    correctedAddressFields?: { street: string; neighborhood: string; postalCode: string; city: string };
    orders: string[]; planLabel: string; serviceDate: string; lateSeconds: number | null;
    before: { latitude: number | null; longitude: number | null };
    point: { latitude: number; longitude: number }; distanceMeters: number };
};
export type DriverIncidentReport = {
  rows: DriverIncident[]; nextCursor: string | null;
  drivers: { id: string; name: string; active: boolean }[];
  from: string; to: string; driverId: string | null; timezone: string;
};

export function incidentFilters(params: URLSearchParams, timezone: string) {
  const from = serviceDate(params.get("from") ?? todayInTimezone(timezone));
  const to = serviceDate(params.get("to") ?? from);
  if (from > to) throw new AppError("INVALID_DATE");
  const driverId = params.get("driverId") ? uuid(params.get("driverId")) : null;
  const filterHash = createHash("sha256").update(JSON.stringify([from, to, driverId])).digest("hex");
  let cursor: { time: string; id: string } | null = null;
  const encoded = params.get("cursor");
  if (encoded) {
    try {
      if (encoded.length > 512) throw new Error();
      const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (parsed.filterHash !== filterHash || typeof parsed.time !== "string") throw new Error();
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(parsed.time) || !Number.isFinite(Date.parse(parsed.time))) throw new Error();
      cursor = { time: parsed.time, id: uuid(parsed.id) };
    } catch { throw new AppError("INVALID_CURSOR"); }
  }
  return { from, to, driverId, filterHash, cursor };
}

export async function readDriverIncidents(sql: Sql, params: URLSearchParams, timezone: string): Promise<DriverIncidentReport> {
  const filters = incidentFilters(params, timezone);
  const { rows } = await sql.query(
    `SELECT id,incident_kind,occurred_at,to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,event_date::text,timezone,driver_id,
            details - 'sample' - 'policy' - 'customerBefore' AS details
       FROM route_driver_stop_events
      WHERE incident_kind IS NOT NULL AND event_date BETWEEN $1::date AND $2::date
        AND ($3::uuid IS NULL OR driver_id=$3)
        AND ($4::timestamptz IS NULL OR (occurred_at,id)<($4::timestamptz,$5::uuid))
      ORDER BY occurred_at DESC,id DESC LIMIT 51`,
    [filters.from, filters.to, filters.driverId, filters.cursor?.time ?? null, filters.cursor?.id ?? null],
  );
  const drivers = await sql.query(
    `SELECT d.id,d.name,d.active FROM route_drivers d WHERE d.active OR EXISTS (
       SELECT 1 FROM route_driver_stop_events e WHERE e.driver_id=d.id AND e.incident_kind IS NOT NULL)
       OR EXISTS (SELECT 1 FROM route_driver_service_incidents i WHERE i.driver_id=d.id)
     ORDER BY d.name,d.id`,
  );
  const page = rows.slice(0, 50);
  const last = page.at(-1);
  return {
    rows: page.map((row) => ({ id: row.id, kind: row.incident_kind, occurredAt: row.occurred_at.toISOString(),
      date: row.event_date, timezone: row.timezone, driverId: row.driver_id, details: row.details })),
    drivers: drivers.rows, from: filters.from, to: filters.to, driverId: filters.driverId, timezone,
    nextCursor: rows.length > 50 ? Buffer.from(JSON.stringify({ filterHash: filters.filterHash,
      time: last.cursor_time, id: last.id })).toString("base64url") : null,
  };
}
