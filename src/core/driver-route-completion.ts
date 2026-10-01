import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { transaction } from "./database";
import { authenticateMobile } from "./driver-mobile-auth";
import { executableRoute } from "./driver-execution-read";
import {
  driverCommandReceipt,
  saveDriverCommandReceipt,
} from "./driver-command-receipts";
import {
  routeCompletionInput,
  assertCompletionOrders,
} from "./driver-route-completion-policy";
import { getRoutingSettings } from "./routing-settings";
import { readOperationPolicy } from "./driver-operation-settings";
import { validateProximity } from "./driver-execution-policy";
import { uuid } from "./orders-validation";
import { AppError } from "./errors";

export async function completeDriverRoute(
  pool: Pool,
  authorization: string | null,
  planId: string,
  raw: Record<string, unknown>,
  at?: Date,
) {
  const plan = uuid(planId),
    input = routeCompletionInput(raw);
  const hash = createHash("sha256")
    .update(JSON.stringify({ plan, kind: "route_finish", input }))
    .digest("hex");
  return transaction(pool, async (sql) => {
    const driver = await authenticateMobile(sql, authorization, true);
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `driver-command:${driver.device_id}:${input.commandId}`,
    ]);
    const route = await executableRoute(
      sql,
      driver.driver_id,
      plan,
      true,
      true,
    );
    if (
      route.id !== input.executionId ||
      route.publication_revision !== input.publicationRevision
    )
      throw new AppError("VERSION_CONFLICT", 409);
    const previous = await driverCommandReceipt(
      sql,
      driver.device_id,
      input.commandId,
      hash,
    );
    if (previous) return previous;
    if (route.completed_at) throw new AppError("ROUTE_COMPLETED", 409);
    if (route.revision !== input.executionRevision)
      throw new AppError("VERSION_CONFLICT", 409);
    await sql.query(
      "SELECT pg_advisory_xact_lock_shared(hashtext('ana-rutas:routing-settings'))",
    );
    await sql.query(
      "SELECT version FROM route_routing_settings WHERE singleton=true FOR SHARE",
    );
    const settings = await getRoutingSettings(sql),
      policy = await readOperationPolicy(sql, true);
    if (!settings.depotLocation)
      throw new AppError("ROUTING_ORIGIN_REQUIRED", 409);
    if (settings.version !== input.depotVersion)
      throw new AppError("ROUTING_ORIGIN_CHANGED", 409);
    if (policy.version !== input.policyVersion)
      throw new AppError("OPERATION_POLICY_CHANGED", 409);
    const now = at ?? new Date(),
      distance = validateProximity(
        input.sample,
        settings.depotLocation,
        policy,
        now,
      );
    const publication = (
      await sql.query(
        "SELECT snapshot->'orders' AS orders FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2",
        [plan, route.vehicle_id],
      )
    ).rows[0];
    const orders = (
      await sql.query<{ shipment_id: string; status: string }>(
        "SELECT shipment_id,status FROM route_driver_execution_orders WHERE execution_id=$1 ORDER BY shipment_id FOR SHARE",
        [route.id],
      )
    ).rows;
    assertCompletionOrders(
      publication.orders.map((order: { id: string }) => order.id),
      orders,
    );
    const unpaid = await sql.query(
      `SELECT 1 FROM route_driver_execution_orders o JOIN route_shipments s ON s.id=o.shipment_id
      JOIN route_financial_targets t ON (t.source,t.picking_id,t.order_id)=(s.source,s.picking_id,s.order_id)
      WHERE o.execution_id=$1 AND o.status='delivered' AND t.revision>0 AND NOT EXISTS(
        SELECT 1 FROM route_order_payments p WHERE (p.execution_id,p.shipment_id)=(o.execution_id,o.shipment_id))`,
      [route.id],
    );
    if (unpaid.rowCount) throw new AppError("ROUTE_PAYMENTS_MISSING", 409);
    const details = {
      planId: plan,
      publicationRevision: route.publication_revision,
      executionRevision: route.revision,
      depot: {
        address: settings.depotAddress,
        ...settings.depotLocation,
        version: settings.version,
      },
      policy,
      sample: input.sample,
      distanceMeters: distance,
      orders,
    };
    await sql.query(
      `INSERT INTO route_driver_execution_completions(execution_id,driver_id,device_id,command_id,completed_at,depot_version,details)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        route.id,
        driver.driver_id,
        driver.device_id,
        input.commandId,
        now,
        settings.version,
        JSON.stringify(details),
      ],
    );
    await sql.query(
      "UPDATE route_driver_executions SET revision=revision+1 WHERE id=$1",
      [route.id],
    );
    await sql.query(
      "UPDATE route_live_tracking SET stopped=true,target_stop_id=NULL,eta=NULL,warehouse_depot_version=NULL,received_at=$2 WHERE execution_id=$1",
      [route.id, now],
    );
    await sql.query(
      "INSERT INTO route_driver_mobile_audit(driver_id,action,details) VALUES($1,'mobile.route.completed',$2)",
      [
        driver.driver_id,
        JSON.stringify({
          executionId: route.id,
          deviceId: driver.device_id,
          commandId: input.commandId,
          completedAt: now.toISOString(),
        }),
      ],
    );
    return saveDriverCommandReceipt(
      sql,
      driver.device_id,
      input.commandId,
      hash,
      route.id,
      {
        eventId: null,
        occurredAt: now.toISOString(),
        completedAt: now.toISOString(),
        executionRevision: route.revision + 1,
        duplicate: false,
      },
    );
  });
}
