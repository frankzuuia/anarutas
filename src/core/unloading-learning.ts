import type { Sql } from "./database";
import { maximumUnloadingMinutes } from "./route-service-time";

// Optional telemetry must not reject an otherwise valid financial command.
export function collectionCapturedAt(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const canonical = new Date(milliseconds).toISOString();
  // Require the full UTC timestamp sent by Android (Instant may omit .000).
  return value === canonical || value === canonical.replace(".000Z", "Z")
    ? canonical
    : null;
}

export function usableCollectionTime(
  capturedAt: string | null,
  arrivedAt: Date,
  receivedAt: Date,
) {
  if (capturedAt === null) return false;
  const elapsed = Date.parse(capturedAt) - arrivedAt.getTime();
  return (
    elapsed > 0 &&
    elapsed <= maximumUnloadingMinutes * 60_000 &&
    Date.parse(capturedAt) <= receivedAt.getTime()
  );
}

/** Called after the accepted payment, while its execution/stop remain locked.
 * No customer UPDATE: learning cannot enqueue routing or invert the plan lock order. */
export async function recordUnloadingCollection(
  sql: Sql,
  paymentId: string,
  stopId: string,
  visitSequence: number,
  capturedAt: string | null,
  receivedAt: Date,
) {
  const arrival = (
    await sql.query(
      `SELECT e.id,e.occurred_at,c.id AS customer_id,c.location_version
    FROM route_driver_stop_events e
    JOIN route_driver_execution_stops s ON s.id=e.stop_id AND s.execution_id=e.execution_id
    JOIN route_customers c ON c.id=s.customer_id
    JOIN route_order_payments p ON p.id=$1 AND p.execution_id=e.execution_id AND p.shipment_id=ANY(s.shipment_ids)
    WHERE e.stop_id=$2 AND e.visit_sequence=$3 AND e.kind='arrival'
      AND c.archived_at IS NULL AND c.fulfillment_mode='delivery'
      AND e.details->>'customerLocationVersion'=c.location_version::text
      AND (e.details->'point'->>'latitude')::double precision=c.latitude
      AND (e.details->'point'->>'longitude')::double precision=c.longitude`,
      [paymentId, stopId, visitSequence],
    )
  ).rows[0];
  if (
    !arrival ||
    !usableCollectionTime(capturedAt, arrival.occurred_at, receivedAt)
  )
    return;
  await sql.query(
    `INSERT INTO route_unloading_observations(payment_id,arrival_event_id,captured_at)
    VALUES($1,$2,$3) ON CONFLICT(payment_id) DO NOTHING`,
    [paymentId, arrival.id, capturedAt],
  );
  // Every order at this stop must close with collection in this SAME continuous visit.
  // An older APK, a previous visit or partial/rejected/rescheduled work cannot seed a full duration.
  await sql.query(
    `INSERT INTO route_unloading_visits(arrival_event_id,customer_id,location_version,arrived_at,completed_at)
    SELECT $1,$2,$3,$4,max(obs.captured_at)
    FROM route_driver_execution_orders o
    LEFT JOIN route_order_payments p ON p.execution_id=o.execution_id AND p.shipment_id=o.shipment_id
    LEFT JOIN route_unloading_observations obs ON obs.payment_id=p.id AND obs.arrival_event_id=$1
    WHERE o.stop_id=$5
    HAVING count(*)>0 AND bool_and(o.status='delivered') AND count(obs.payment_id)=count(*)
    ON CONFLICT(arrival_event_id) DO NOTHING`,
    [
      arrival.id,
      arrival.customer_id,
      arrival.location_version,
      arrival.occurred_at,
      stopId,
    ],
  );
}
