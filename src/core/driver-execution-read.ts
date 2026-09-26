import type { Pool } from "pg";
import { transaction, type Sql } from "./database";
import { AppError } from "./errors";
import { uuid } from "./orders-validation";
import { readOperationPolicy } from "./driver-operation-settings";
import type { PublishedOrder } from "./driver-execution-policy";
import type { DriverOrderStatus } from "./driver-service-policy";

export type ExecutionRow = {
  id: string; plan_id: string; vehicle_id: string; publication_revision: number;
  revision: number; driver_id: string; started_at: Date; service_date: string;
  plan_label: string; vehicle_name: string; vehicle_plate: string; driver_name: string;
};
export type ExecutionStopRow = {
  id: string; execution_id: string; customer_id: string; position: number;
  shipment_ids: string[]; customer_name: string; address: string; order_names: string[];
  windows: PublishedOrder["deliveryWindows"]; latitude: number | null; longitude: number | null;
  version: number; arrived_at: Date | null; corrected_at: Date | null;
  visit_state: "open" | "arrived"; visit_sequence: number;
};

export async function executableRoute(sql: Sql, driverId: string, planId: string, write: boolean) {
  const plan = await sql.query("SELECT id FROM route_plans WHERE id=$1 FOR SHARE", [uuid(planId)]);
  if (!plan.rowCount) throw new AppError("NOT_FOUND", 404);
  const { rows } = await sql.query(
    `SELECT pub.vehicle_id,pub.revision,pub.started_at FROM route_plan_publications pub
       JOIN route_plan_vehicles pv ON pv.plan_id=pub.plan_id AND pv.vehicle_id=pub.vehicle_id
       JOIN route_drivers d ON d.id=pub.started_driver_id
      WHERE pub.plan_id=$1 AND pub.started_driver_id=$2 AND pv.driver_id=$2
        AND pub.revoked_at IS NULL AND d.active AND pub.started_at IS NOT NULL
      FOR ${write ? "UPDATE" : "SHARE"} OF pub`,
    [planId, driverId],
  );
  if (rows.length !== 1) throw new AppError("NOT_FOUND", 404);
  const pub = rows[0];
  const execution = await sql.query<ExecutionRow>(
    `SELECT e.*,e.service_date::text FROM route_driver_executions e
      WHERE plan_id=$1 AND vehicle_id=$2 AND publication_revision=$3 AND driver_id=$4
      FOR ${write ? "UPDATE" : "SHARE"}`,
    [planId, pub.vehicle_id, pub.revision, driverId],
  );
  if (!execution.rows[0]) throw new AppError("EXECUTION_NOT_READY", 503);
  return execution.rows[0];
}

export async function readDriverExecution(pool: Pool, driverId: string, planId: string, timezone: string) {
  return transaction(pool, async (sql) => {
    const route = await executableRoute(sql, driverId, planId, false);
    const policy = await readOperationPolicy(sql, true);
    const orders = await sql.query<{ stop_id: string; shipment_id: string; status: DriverOrderStatus; version: number }>(
      "SELECT stop_id,shipment_id,status,version FROM route_driver_execution_orders WHERE execution_id=$1", [route.id]);
    const { rows } = await sql.query<ExecutionStopRow & { customer_location_version: number; archived: boolean; phone: string | null; customer_version: number; closed_visit: number }>(
      `SELECT s.*,c.location_version AS customer_location_version,(c.archived_at IS NOT NULL) AS archived,
              c.phone,c.version AS customer_version,
              coalesce((SELECT max(i.visit_sequence) FROM route_driver_service_incidents i
                WHERE i.execution_id=s.execution_id AND i.stop_id=s.id AND i.kind='customer_closed'),0) AS closed_visit
         FROM route_driver_execution_stops s JOIN route_customers c ON c.id=s.customer_id
        WHERE s.execution_id=$1 ORDER BY s.position`, [route.id],
    );
    return {
      id: route.id, planId: route.plan_id, vehicleId: route.vehicle_id,
      publicationRevision: route.publication_revision, revision: route.revision,
      startedAt: route.started_at.toISOString(), serviceDate: route.service_date,
      serverTime: new Date().toISOString(), timezone, policy,
      hasCorrections: rows.some((stop) => stop.corrected_at !== null),
      stops: rows.map((stop) => ({
        id: stop.id, customerId: stop.customer_id, position: stop.position,
        shipmentIds: stop.shipment_ids, customer: stop.customer_name, address: stop.address,
        orderNames: stop.order_names, windows: stop.windows, latitude: stop.latitude, longitude: stop.longitude,
        version: stop.version, customerLocationVersion: stop.customer_location_version,
        customerArchived: stop.archived, arrivedAt: stop.arrived_at?.toISOString() ?? null,
        visitState: stop.visit_state, visitSequence: stop.visit_sequence,
        phone: stop.phone, customerVersion: stop.customer_version,
        closedReportedVisitSequence: stop.closed_visit,
        orderStates: orders.rows.filter(order => order.stop_id === stop.id)
          .sort((a, b) => stop.shipment_ids.indexOf(a.shipment_id) - stop.shipment_ids.indexOf(b.shipment_id)).map(order => ({
          shipmentId: order.shipment_id, status: order.status, version: order.version,
        })),
      })),
    };
  });
}
