import type { Sql } from "./database";
import type { Shipment } from "./orders-contract";

type ValidationOrder = Pick<Shipment, "id" | "orderName"> & {
  fulfillmentStatus?: string | null;
};

/** The caller supplies only the authorized vehicle's orders, under its plan lock. */
export function routeStartPendingOrders(orders: ValidationOrder[]) {
  return orders
    .filter((order) => order.fulfillmentStatus !== "validated")
    .map((order) => ({ id: order.id, orderName: order.orderName }));
}

/** Legacy imports were validated-only; match readOrderBoard's existing fallback. */
export async function readRouteStartPendingOrders(
  sql: Sql,
  planId: string,
  vehicleId: string,
) {
  const { rows } = await sql.query<ValidationOrder>(
    `SELECT id,snapshot->>'orderName' AS "orderName",
       CASE WHEN snapshot ? 'fulfillmentStatus' THEN snapshot->>'fulfillmentStatus'
         ELSE 'validated' END AS "fulfillmentStatus"
     FROM route_shipments WHERE plan_id=$1 AND vehicle_id=$2 ORDER BY position,id`,
    [planId, vehicleId],
  );
  return routeStartPendingOrders(rows);
}
