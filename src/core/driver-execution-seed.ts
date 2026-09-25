import { randomUUID } from "node:crypto";
import type { Sql } from "./database";
import { AppError } from "./errors";
import { groupExecutionStops, type PublishedOrder } from "./driver-execution-policy";

// Called only from the start transaction or the migration, never from a GET.
export async function createDriverExecution(sql: Sql, planId: string, vehicleId: string) {
  const { rows } = await sql.query(
    `SELECT p.plan_id,p.vehicle_id,p.revision,p.started_at,p.started_driver_id,
            p.snapshot,d.name AS driver_name
       FROM route_plan_publications p JOIN route_drivers d ON d.id=p.started_driver_id
      WHERE p.plan_id=$1 AND p.vehicle_id=$2 AND p.revoked_at IS NULL AND p.started_at IS NOT NULL`,
    [planId, vehicleId],
  );
  const pub = rows[0];
  if (!pub) throw new AppError("ROUTE_NOT_STARTED", 409);
  const result = await sql.query(
    `INSERT INTO route_driver_executions(id,plan_id,vehicle_id,publication_revision,driver_id,
       started_at,service_date,plan_label,vehicle_name,vehicle_plate,driver_name)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(plan_id,vehicle_id,publication_revision) DO NOTHING RETURNING id`,
    [randomUUID(), planId, vehicleId, pub.revision, pub.started_driver_id, pub.started_at,
      pub.snapshot.plan.serviceDate, pub.snapshot.plan.label, pub.snapshot.vehicle.name,
      pub.snapshot.vehicle.plate, pub.driver_name],
  );
  if (!result.rowCount) return;
  const orders = pub.snapshot.orders as PublishedOrder[];
  const identities = await sql.query(
    `SELECT s.id,c.id AS customer_id FROM route_shipments s
       JOIN route_customers c ON c.source=s.source AND c.odoo_partner_id=s.partner_id
      WHERE s.plan_id=$1 AND s.vehicle_id=$2 AND s.id=ANY($3::uuid[])`,
    [planId, vehicleId, orders.map((order) => order.id)],
  );
  const groups = groupExecutionStops(orders, new Map(identities.rows.map((row) => [row.id, row.customer_id])));
  for (const [index, group] of groups.entries()) {
    const first = group.orders[0];
    await sql.query(
      `INSERT INTO route_driver_execution_stops(id,execution_id,position,customer_id,
         shipment_ids,customer_name,address,order_names,windows,latitude,longitude,
         original_latitude,original_longitude)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,$11)`,
      [randomUUID(), result.rows[0].id, index + 1, group.customerId,
        group.orders.map((order) => order.id), first.customerName, first.address,
        group.orders.map((order) => order.orderName), JSON.stringify(first.deliveryWindows),
        first.latitude, first.longitude],
    );
  }
}
