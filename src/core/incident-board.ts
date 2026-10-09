import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { assertActiveActor, audit, transaction } from "./database";
import { AppError } from "./errors";
import { incidentFilters } from "./driver-incidents";
import { integer, uuid } from "./orders-validation";
import {
  resolvedIncidentSource,
  seenIncidentSource,
} from "./incident-board-resolved-source";

export type IncidentSource = "product" | "service" | "stop";
export type IncidentSeen = {
  sequence: string;
  seenBy: string | null;
  seenAt: string | null;
};
export type IncidentBoardRow = {
  key: string;
  source: IncidentSource;
  id: string;
  kind: string;
  driverId: string;
  occurredAt: string;
  timezone: string;
  status: string;
  version: number;
  notification: IncidentSeen | null;
  odooReturn?: {
    status: string;
    reference: string | null;
    error: string | null;
  } | null;
  detail: {
    driver: string;
    customer: string;
    vehicle: string;
    plate: string;
    address: string;
    planLabel: string;
    orders: string[];
    note?: string | null;
    product?: string;
    quantity?: string;
    unit?: string;
    reasonCode?: string | null;
    warehouseReason?: string | null;
    canResolve: boolean;
    resolutionNote?: string | null;
    photos: string[];
    lateSeconds?: number;
    previousAddress?: string;
    correctedAddress?: string;
    before?: { latitude: number | null; longitude: number | null };
    point?: { latitude: number; longitude: number };
  };
};
export type IncidentBoardReport = {
  rows: IncidentBoardRow[];
  nextCursor: string | null;
  total: number;
  unseen: number;
  outsideFilter: number;
  drivers: { id: string; name: string }[];
};
export type IncidentAlertSettings = { seconds: 5 | 10 | 15; version: number };
export type IncidentAlerts = {
  scope: string;
  cursor: string;
  more: boolean;
  settings: IncidentAlertSettings;
  rows: { sequence: string; driverId: string }[];
  watching: string[];
};

const notificationJoin = `LEFT JOIN route_incident_notifications n ON
  (e.source='product' AND n.product_id=e.id) OR (e.source='service' AND n.service_id=e.id)
  OR (e.source='stop' AND n.stop_event_id=e.id)`;
const unseen = "(n.sequence IS NOT NULL AND n.seen_at IS NULL)";
const sourceEntries = (source: string) => `FROM ${source} e ${notificationJoin}
  LEFT JOIN route_odoo_return_capture rc ON e.source='product' AND e.kind='return' AND rc.incident_id=e.id
  LEFT JOIN route_odoo_return_incidents ri ON e.source='product' AND e.kind='return' AND ri.incident_id=e.id
  LEFT JOIN route_odoo_return_jobs rj ON rj.id=ri.job_id`;
const entries = sourceEntries("route_incident_live_entries");

export function incidentIdentity(value: unknown): {
  source: IncidentSource;
  id: string;
} {
  if (typeof value !== "string") throw new AppError("INVALID_INPUT");
  const parts = value.split(":");
  if (parts.length !== 2 || !["product", "service", "stop"].includes(parts[0]))
    throw new AppError("INVALID_INPUT");
  return { source: parts[0] as IncidentSource, id: uuid(parts[1]) };
}
export function notificationSequence(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(value))
    throw new AppError("INVALID_CURSOR");
  if (BigInt(value) > 9223372036854775807n)
    throw new AppError("INVALID_CURSOR");
  return value;
}
export function alarmSettingsInput(raw: Record<string, unknown>) {
  if (
    Object.keys(raw).some(
      (key) => !["seconds", "expectedVersion"].includes(key),
    ) ||
    ![5, 10, 15].includes(raw.seconds as number)
  )
    throw new AppError("INVALID_INPUT");
  return {
    seconds: raw.seconds as 5 | 10 | 15,
    version: integer(raw.expectedVersion, 1),
  };
}

export async function readIncidentBoard(
  pool: Pool,
  actor: string,
  params: URLSearchParams,
  timezone: string,
): Promise<IncidentBoardReport> {
  const query = new URLSearchParams(params);
  query.delete("cursor");
  const filters = incidentFilters(query, timezone, "all");
  const section = params.get("section") ?? "routes";
  if (
    !["routes", "resolved", "late", "location"].includes(section) ||
    ![null, "true"].includes(params.get("unseen"))
  )
    throw new AppError("INVALID_INPUT");
  const onlyUnseen = params.get("unseen") === "true";
  const filterHash = createHash("sha256")
    .update(JSON.stringify([filters.filterHash, section, onlyUnseen]))
    .digest("hex");
  let cursor: {
    pending: boolean;
    time: string;
    id: string;
    source: IncidentSource;
  } | null = null;
  if (params.has("cursor")) {
    try {
      const raw = params.get("cursor")!;
      if (raw.length > 512) throw new Error();
      const value = JSON.parse(Buffer.from(raw, "base64url").toString());
      if (
        value.filterHash !== filterHash ||
        typeof value.pending !== "boolean" ||
        typeof value.time !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(value.time) ||
        !Number.isFinite(Date.parse(value.time))
      )
        throw new Error();
      cursor = {
        ...incidentIdentity(`${value.source}:${value.id}`),
        pending: value.pending,
        time: value.time,
      };
    } catch {
      throw new AppError("INVALID_CURSOR");
    }
  }
  const boardEntries =
    section === "resolved" ? sourceEntries(resolvedIncidentSource) : entries;
  const where = `${boardEntries} WHERE ($1::date IS NULL OR e.event_date>=$1::date)
    AND ($2::date IS NULL OR e.event_date<=$2::date) AND ($3::uuid IS NULL OR e.driver_id=$3)
    AND (($4='routes' AND e.source<>'stop' AND e.status<>'resolved_by_admin') OR $4='resolved'
      OR ($4='late' AND e.kind='late_arrival') OR ($4='location' AND e.kind='location_corrected'))
    AND (NOT $5::boolean OR ${unseen})`;
  return transaction(pool, async (sql) => {
    await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await assertActiveActor(sql, actor);
    const values = [
      filters.from,
      filters.to,
      filters.driverId,
      section,
      onlyUnseen,
    ];
    const counts = (
      await sql.query(
        `SELECT count(*)::int total,count(*) FILTER(WHERE ${unseen})::int unseen ${where}`,
        values,
      )
    ).rows[0];
    const { rows } = await sql.query(
      `SELECT e.*,n.sequence::text,n.seen_name,n.seen_at,${unseen} AS pending,
      COALESCE(rj.status,CASE WHEN rc.incident_id IS NOT NULL THEN 'awaiting_collection' END) AS return_status,
      rj.receipt->>'name' AS return_reference,rj.last_error AS return_error,
      to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
      ${where} AND ($6::boolean IS NULL OR (${unseen},e.occurred_at,e.id,e.source)<($6::boolean,$7::timestamptz,$8::uuid,$9::text))
      ORDER BY ${unseen} DESC,e.occurred_at DESC,e.id DESC,e.source DESC LIMIT 51`,
      [
        ...values,
        cursor?.pending ?? null,
        cursor?.time ?? null,
        cursor?.id ?? null,
        cursor?.source ?? null,
      ],
    );
    const outside = (
      await sql.query(
        `SELECT count(*)::int n ${entries} WHERE ${unseen} AND
      (($1::date IS NOT NULL AND e.event_date<$1::date) OR ($2::date IS NOT NULL AND e.event_date>$2::date)
       OR ($3::uuid IS NOT NULL AND e.driver_id<>$3))`,
        values.slice(0, 3),
      )
    ).rows[0].n;
    const drivers = (
      await sql.query(`SELECT d.id,d.name FROM route_drivers d WHERE d.active OR EXISTS
      (SELECT 1 FROM route_incident_live_entries e WHERE e.driver_id=d.id)
      OR EXISTS (SELECT 1 FROM route_product_incidents i WHERE i.driver_id=d.id AND i.status='resolved'
        AND i.report_removed_at IS NULL) ORDER BY d.name,d.id`)
    ).rows;
    const page = rows.slice(0, 50),
      last = page.at(-1);
    return {
      ...counts,
      outsideFilter: outside,
      drivers,
      rows: page.map((row) => ({
        key: `${row.source}:${row.id}`,
        source: row.source,
        id: row.id,
        kind: row.kind,
        driverId: row.driver_id,
        occurredAt: row.occurred_at.toISOString(),
        timezone: row.timezone,
        status: row.status,
        version: row.version,
        detail: row.detail,
        odooReturn: row.return_status
          ? {
              status: row.return_status,
              reference: row.return_reference,
              error: row.return_error,
            }
          : null,
        notification: row.sequence
          ? {
              sequence: row.sequence,
              seenBy: row.seen_name,
              seenAt: row.seen_at?.toISOString() ?? null,
            }
          : null,
      })),
      nextCursor:
        rows.length > 50
          ? Buffer.from(
              JSON.stringify({
                filterHash,
                pending: last.pending,
                time: last.cursor_time,
                id: last.id,
                source: last.source,
              }),
            ).toString("base64url")
          : null,
    };
  });
}

export async function markIncidentSeen(
  pool: Pool,
  actor: string,
  raw: Record<string, unknown>,
): Promise<IncidentSeen> {
  if (Object.keys(raw).some((key) => key !== "key"))
    throw new AppError("INVALID_INPUT");
  const { source, id } = incidentIdentity(raw.key);
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const target = (
      await sql.query(
        `SELECT n.sequence ${sourceEntries(seenIncidentSource)} WHERE e.source=$1 AND e.id=$2`,
        [source, id],
      )
    ).rows[0];
    if (!target?.sequence) throw new AppError("NOT_FOUND", 404);
    const changed = await sql.query(
      `UPDATE route_incident_notifications SET seen_by=$2,
      seen_name=(SELECT name FROM route_users WHERE id=$2),seen_at=clock_timestamp()
      WHERE sequence=$1 AND seen_at IS NULL RETURNING sequence`,
      [target.sequence, actor],
    );
    if (changed.rowCount)
      await audit(sql, actor, "incident.seen", raw.key as string);
    const row = (
      await sql.query(
        "SELECT sequence::text,seen_name,seen_at FROM route_incident_notifications WHERE sequence=$1",
        [target.sequence],
      )
    ).rows[0];
    return {
      sequence: row.sequence,
      seenBy: row.seen_name,
      seenAt: row.seen_at.toISOString(),
    };
  });
}

export async function updateIncidentAlarm(
  pool: Pool,
  actor: string,
  raw: Record<string, unknown>,
): Promise<IncidentAlertSettings> {
  const input = alarmSettingsInput(raw);
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const before = (
      await sql.query(
        "SELECT seconds,version FROM route_incident_alert_settings WHERE singleton FOR UPDATE",
      )
    ).rows[0];
    if (before.version !== input.version)
      throw new AppError("VERSION_CONFLICT", 409);
    const after = (
      await sql.query(
        "UPDATE route_incident_alert_settings SET seconds=$1,version=version+1 WHERE singleton RETURNING seconds,version",
        [input.seconds],
      )
    ).rows[0];
    await audit(sql, actor, "incident.alarm.updated", null, { before, after });
    return after;
  });
}

export async function readIncidentAlerts(
  pool: Pool,
  actor: string,
  params: URLSearchParams,
): Promise<IncidentAlerts> {
  const after = params.has("after")
    ? notificationSequence(params.get("after"))
    : null;
  const watch = params.get("watch")?.split(",") ?? [];
  if (watch.length > 100) throw new AppError("INVALID_INPUT");
  watch.forEach(notificationSequence);
  return transaction(pool, async (sql) => {
    await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await assertActiveActor(sql, actor);
    const settings = (
      await sql.query(
        "SELECT seconds,version FROM route_incident_alert_settings WHERE singleton",
      )
    ).rows[0];
    const latest = (
      await sql.query(
        "SELECT COALESCE(max(sequence),0)::text AS cursor FROM route_incident_notifications",
      )
    ).rows[0].cursor;
    // Page the durable source, not just visible/unseen rows: no holes on reconnect.
    const page =
      after === null
        ? []
        : (
            await sql.query(
              `SELECT n.sequence::text,e.driver_id,
      n.seen_at IS NULL AND e.id IS NOT NULL AND e.kind<>'late_arrival' AS pending FROM route_incident_notifications n
      LEFT JOIN route_incident_live_entries e ON (e.source='product' AND e.id=n.product_id)
        OR (e.source='service' AND e.id=n.service_id) OR (e.source='stop' AND e.id=n.stop_event_id)
      WHERE n.sequence>$1 ORDER BY n.sequence LIMIT 101`,
              [after],
            )
          ).rows;
    const taken = page.slice(0, 100);
    const watching = watch.length
      ? (
          await sql.query(
            `SELECT n.sequence::text ${entries}
      WHERE n.sequence=ANY($1::bigint[]) AND n.seen_at IS NULL AND e.kind<>'late_arrival'`,
            [watch],
          )
        ).rows.map((row) => row.sequence)
      : [];
    const installation = (
      await sql.query(
        "SELECT instance_id FROM rutas_installation WHERE singleton",
      )
    ).rows[0].instance_id;
    return {
      scope: createHash("sha256")
        .update(`${installation}:${actor}`)
        .digest("hex"),
      settings,
      cursor: page.length > 100 ? taken.at(-1)!.sequence : latest,
      more: page.length > 100,
      rows: taken
        .filter((row) => row.pending)
        .map((row) => ({ sequence: row.sequence, driverId: row.driver_id })),
      watching,
    };
  });
}
