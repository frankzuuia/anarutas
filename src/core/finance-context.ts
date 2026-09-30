import type { Sql } from "./database";
import { authenticateMobile } from "./driver-mobile-auth";
import { AppError } from "./errors";
import { uuid } from "./orders-validation";
import type { ExecutionRow } from "./driver-execution-read";
import type { PublishedOrder } from "./driver-execution-policy";
import { readPublicationFinancials } from "./driver-financial-store";
import { financialHash } from "./financial-policy";
import type { FinancialPublishedLine } from "./driver-financial-contract";
type FinanceOrder = PublishedOrder & { lines: FinancialPublishedLine[] };

export async function lockFinanceExecution(
  sql: Sql,
  executionId: string,
  driverId?: string,
) {
  const id = uuid(executionId);
  const row = (
    await sql.query<ExecutionRow>(
      "SELECT * FROM route_driver_executions WHERE id=$1",
      [id],
    )
  ).rows[0];
  if (!row || (driverId && row.driver_id !== driverId))
    throw new AppError("NOT_FOUND", 404);
  // Same lock ordering as operational commands; absence of a retired plan is allowed.
  await sql.query("SELECT id FROM route_plans WHERE id=$1 FOR SHARE", [
    row.plan_id,
  ]);
  await sql.query(
    "SELECT plan_id FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2 FOR SHARE",
    [row.plan_id, row.vehicle_id],
  );
  return (
    await sql.query<ExecutionRow>(
      `SELECT e.*,e.service_date::text AS service_date,c.completed_at FROM route_driver_executions e
    LEFT JOIN route_driver_execution_completions c ON c.execution_id=e.id WHERE e.id=$1 FOR UPDATE OF e`,
      [id],
    )
  ).rows[0];
}
export async function mobileFinanceContext(
  sql: Sql,
  authorization: string | null,
  executionId: string,
) {
  const driver = await authenticateMobile(sql, authorization, true);
  const route = await lockFinanceExecution(sql, executionId, driver.driver_id);
  return { driver, route };
}
export async function financeOrders(
  sql: Sql,
  route: ExecutionRow,
  now = new Date(),
) {
  const rows = (
    await sql.query(
      `SELECT o.shipment_id,o.status,o.version,s.customer_name,s.order_names,s.shipment_ids,f.details
    FROM route_driver_execution_orders o JOIN route_driver_execution_stops s ON s.id=o.stop_id
    LEFT JOIN route_finance_execution_orders f ON (f.execution_id,f.shipment_id)=(o.execution_id,o.shipment_id)
    WHERE o.execution_id=$1 ORDER BY s.position,o.shipment_id`,
      [route.id],
    )
  ).rows;
  const publications = rows
    .filter((row) => row.details)
    .map((row) => row.details as FinanceOrder);
  const views = await readPublicationFinancials(
    sql,
    route.plan_id,
    route.vehicle_id,
    route.publication_revision,
    publications,
    now,
  );
  const incidents = (
    await sql.query(
      `SELECT id,shipment_id,kind,product,quantity::text,unit,note,status,version,replacement_payment,
    evidence_id,ARRAY(SELECT p.evidence_id FROM route_product_incident_photos p WHERE p.incident_id=i.id ORDER BY p.position) AS evidence_ids,
    financial_revision,financial_move_id,financial_sale_line_id FROM route_product_incidents i WHERE execution_id=$1 ORDER BY id`,
      [route.id],
    )
  ).rows;
  return rows.map((row) => {
    const financial = views.get(row.shipment_id) ?? null;
    const related = incidents.filter((i) => i.shipment_id === row.shipment_id);
    const basis = financialHash({
      orderVersion: row.version,
      financial: financial && {
        revision: financial.revision,
        currency: financial.currency,
        lines: financial.lines,
        totals: financial.totals,
        issues: financial.issues,
      },
      incidents: related,
    });
    return {
      shipmentId: row.shipment_id as string,
      status: row.status as string,
      version: row.version as number,
      order: row.details as FinanceOrder | null,
      orderName: row.order_names[
        row.shipment_ids.indexOf(row.shipment_id)
      ] as string,
      customer: row.customer_name as string,
      financial,
      incidents: related,
      basis,
    };
  });
}
