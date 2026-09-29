import type { Pool } from "pg";
import { assertActiveActor, audit, transaction } from "./database";
import { AppError } from "./errors";
import { integer, uuid } from "./orders-validation";

export async function cancelProductIncidentByAdmin(pool: Pool, actor: string, id: string, raw: Record<string, unknown>) {
  const incidentId = uuid(id), version = integer(raw.expectedVersion, 1);
  return transaction(pool, async sql => {
    await assertActiveActor(sql, actor);
    const identity = (await sql.query(`SELECT execution_id,stop_id,shipment_id FROM route_product_incidents WHERE id=$1`, [incidentId])).rows[0];
    if (!identity) throw new AppError("NOT_FOUND", 404);
    // Same lock order as driver commands; this also covers archived/finished routes.
    await sql.query("SELECT id FROM route_driver_executions WHERE id=$1 FOR UPDATE", [identity.execution_id]);
    await sql.query("SELECT id FROM route_driver_execution_stops WHERE id=$1 FOR UPDATE", [identity.stop_id]);
    const order = (await sql.query(`SELECT status FROM route_driver_execution_orders
      WHERE execution_id=$1 AND shipment_id=$2 FOR UPDATE`, [identity.execution_id, identity.shipment_id])).rows[0];
    const row = (await sql.query(`SELECT status,version,report_removed_at,report_removed_by FROM route_product_incidents
      WHERE id=$1 FOR UPDATE`, [incidentId])).rows[0];
    if (row.report_removed_by === actor && row.version === version + 1)
      return { canceled: true, duplicate: true, version: row.version };
    if (row.version !== version || row.status === "canceled" || row.report_removed_at !== null) throw new AppError("VERSION_CONFLICT", 409);
    const closed = order.status === "delivered" || order.status === "rescheduled";
    await sql.query("SELECT set_config('ana.product_incident_actor_id',$1,true)", [actor]);
    if (closed) await sql.query(`UPDATE route_product_incidents SET report_removed_at=now(),report_removed_by=$2,
      version=version+1 WHERE id=$1`, [incidentId, actor]);
    else {
      await sql.query(`UPDATE route_product_incidents SET status='canceled',canceled_at=now(),canceled_by_admin=$2,
        report_removed_at=now(),report_removed_by=$2,resolved_at=NULL,resolved_by=NULL,resolution_note=NULL,
        version=version+1 WHERE id=$1`, [incidentId, actor]);
      await sql.query("UPDATE route_driver_execution_orders SET version=version+1,updated_at=now() WHERE execution_id=$1 AND shipment_id=$2",
        [identity.execution_id, identity.shipment_id]);
      await sql.query("UPDATE route_driver_execution_stops SET version=version+1 WHERE id=$1", [identity.stop_id]);
      await sql.query("UPDATE route_driver_executions SET revision=revision+1 WHERE id=$1", [identity.execution_id]);
    }
    await audit(sql, actor, "product_incident.canceled", incidentId, { previousStatus: row.status,
      executionId: identity.execution_id, shipmentId: identity.shipment_id, reportOnly: closed, orderStatus: order.status });
    return { canceled: true, duplicate: false, version: version + 1 };
  });
}
