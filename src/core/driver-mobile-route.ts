import type { Pool } from "pg";
import { transaction } from "./database";
import { AppError } from "./errors";
import { uuid } from "./orders-validation";
import { readOrderBoard } from "./orders";
import { readPlanOptimization } from "./route-optimization";

export async function listDriverPlans(pool: Pool, driverId: string) {
  const { rows } = await pool.query(
    `SELECT p.id,p.service_date::text AS service_date,p.label,p.version,
            pv.vehicle_id,v.name AS vehicle_name,v.plate,
            count(s.id)::integer AS orders
     FROM route_plan_vehicles pv
     JOIN route_plans p ON p.id=pv.plan_id
     JOIN route_vehicles v ON v.id=pv.vehicle_id
     LEFT JOIN route_shipments s
       ON s.plan_id=p.id AND s.vehicle_id=pv.vehicle_id
     WHERE pv.driver_id=$1 AND v.driver_id=$1 AND v.available
     GROUP BY p.id,p.service_date,p.label,p.version,pv.vehicle_id,v.name,v.plate
     ORDER BY p.service_date DESC,p.id DESC`,
    [driverId],
  );
  return rows;
}

export async function readDriverPlan(
  pool: Pool,
  driverId: string,
  planId: string,
) {
  const id = uuid(planId);
  return transaction(pool, async (sql) => {
    // Match the planner's lock order (plan, then vehicle) to avoid a
    // read/move deadlock while an administrator changes assignments.
    const plan = await sql.query(
      "SELECT id FROM route_plans WHERE id=$1 FOR SHARE",
      [id],
    );
    if (!plan.rowCount) throw new AppError("NOT_FOUND", 404);
    const membership = await sql.query(
      `SELECT pv.vehicle_id,v.name AS vehicle_name,v.plate
       FROM route_plan_vehicles pv
       JOIN route_vehicles v ON v.id=pv.vehicle_id
       JOIN route_drivers d ON d.id=pv.driver_id
       WHERE pv.plan_id=$1 AND pv.driver_id=$2 AND v.driver_id=$2
         AND v.available AND d.active
       FOR SHARE OF pv,v,d`,
      [id, driverId],
    );
    const assigned = membership.rows[0];
    if (!assigned) throw new AppError("NOT_FOUND", 404);
    const board = await readOrderBoard(sql, id);
    const own = board.shipments
      .filter((shipment) => shipment.vehicle_id === assigned.vehicle_id)
      .map((shipment) => ({
        id: shipment.id,
        orderName: shipment.orderName,
        customerName: shipment.customerName,
        address: shipment.address,
        position: shipment.position,
        phone: shipment.phone,
        priority: shipment.priority,
        deliveryWindows: shipment.deliveryWindows,
        deliveryNote: shipment.deliveryNote,
        fulfillmentMode: shipment.fulfillmentMode,
        latitude: shipment.latitude,
        longitude: shipment.longitude,
        locationStatus: shipment.locationStatus,
        lines: shipment.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unit: line.unit,
          pickerNote: line.pickerNote ?? null,
        })),
      }));
    const optimization = await readPlanOptimization(sql, id);
    const route = optimization?.current
      ? (optimization.routes.find(
          (route) => route.vehicleId === assigned.vehicle_id,
        ) ?? null)
      : null;
    return {
      plan: {
        id: board.plan.id,
        label: board.plan.label,
        serviceDate: board.plan.service_date,
        version: board.plan.version,
      },
      vehicle: {
        id: assigned.vehicle_id as string,
        name: assigned.vehicle_name as string,
        plate: assigned.plate as string,
      },
      orders: own,
      routeStatus: !optimization
        ? "not_calculated"
        : optimization.current
          ? "current"
          : "stale",
      route,
    };
  });
}
