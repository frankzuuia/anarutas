import type { Pool } from "pg";
import { assertActiveActor, audit, transaction } from "./database";
import { AppError } from "./errors";
import { integer, uuid } from "./orders-validation";

export async function cancelProductIncidentByAdmin(pool: Pool, actor: string, id: string, raw: Record<string, unknown>) {
  const incidentId = uuid(id), version = integer(raw.expectedVersion, 1);
  return transaction(pool, async sql => {
    await assertActiveActor(sql, actor);
    const identity = (await sql.query(`SELECT i.execution_id,i.stop_id,i.shipment_id,e.plan_id,e.vehicle_id,e.publication_revision
      FROM route_product_incidents i JOIN route_driver_executions e ON e.id=i.execution_id WHERE i.id=$1`, [incidentId])).rows[0];
    if (!identity) throw new AppError("NOT_FOUND", 404);
    // Lock the lifecycle before execution, as driver commands do. Missing/replaced
    // publications mean report-only removal; never revalidate an obsolete product line.
    await sql.query("SELECT id FROM route_plans WHERE id=$1 FOR SHARE", [identity.plan_id]);
    const publication = (await sql.query(`SELECT (revision=$3 AND started_at IS NOT NULL AND revoked_at IS NULL) AS is_current
      FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2 FOR SHARE`,
    [identity.plan_id, identity.vehicle_id, identity.publication_revision])).rows[0];
    const routeRetired = publication?.is_current !== true;
    await sql.query("SELECT id FROM route_driver_executions WHERE id=$1 FOR UPDATE", [identity.execution_id]);
    await sql.query("SELECT id FROM route_driver_execution_stops WHERE id=$1 FOR UPDATE", [identity.stop_id]);
    const order = (await sql.query(`SELECT status FROM route_driver_execution_orders
      WHERE execution_id=$1 AND shipment_id=$2 FOR UPDATE`, [identity.execution_id, identity.shipment_id])).rows[0];
    const row = (await sql.query(`SELECT status,version,report_removed_at,report_removed_by FROM route_product_incidents
      WHERE id=$1 FOR UPDATE`, [incidentId])).rows[0];
    if (row.report_removed_by === actor && row.version === version + 1)
      return { canceled: true, duplicate: true, version: row.version };
    if (row.version !== version || row.status === "canceled" || row.report_removed_at !== null) throw new AppError("VERSION_CONFLICT", 409);
    const reportOnly = routeRetired || order.status === "delivered" || order.status === "rescheduled";
    await sql.query("SELECT set_config('ana.product_incident_actor_id',$1,true)", [actor]);
    if (reportOnly) await sql.query(`UPDATE route_product_incidents SET report_removed_at=now(),report_removed_by=$2,
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
      executionId: identity.execution_id, shipmentId: identity.shipment_id, reportOnly, routeRetired, orderStatus: order.status });
    return { canceled: true, duplicate: false, version: version + 1 };
  });
}
