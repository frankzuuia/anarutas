import type { Sql } from "./database";
import type { FinancialSnapshot } from "./financial-contract";
import type { ShipmentLine } from "./orders-contract";
import type {
  DriverFinancialView,
  FinancialIncidentRow,
  FinancialPublishedLine,
  IncidentFinancialReference,
} from "./driver-financial-contract";
import {
  financialLineIdentity,
  projectDriverFinancials,
} from "./driver-financial-policy";
import { financialSyncConfig } from "./financial-config";
import { AppError } from "./errors";

type FinancialRow = {
  id: string;
  snapshot: { lines: ShipmentLine[] };
  revision: number | null;
  financial_snapshot: FinancialSnapshot | null;
  last_success_at: Date | null;
  last_error: string | null;
};
type PublishedFinancialOrder = { id: string; lines: FinancialPublishedLine[] };
async function sourceRows(sql: Sql, shipmentIds: string[]) {
  return (
    await sql.query<FinancialRow>(
      `SELECT s.id,s.snapshot,t.revision,t.last_success_at,t.last_error,r.snapshot AS financial_snapshot
    FROM route_shipments s LEFT JOIN route_financial_targets t
      ON (t.source,t.picking_id,t.order_id)=(s.source,s.picking_id,s.order_id)
    LEFT JOIN route_financial_revisions r ON (r.source,r.picking_id,r.order_id,r.revision)=(t.source,t.picking_id,t.order_id,t.revision)
    WHERE s.id=ANY($1::uuid[])`,
      [shipmentIds],
    )
  ).rows;
}

/** Private composition helper: caller has already locked and authorized this publication. */
export async function readPublicationFinancials(
  sql: Sql,
  planId: string,
  vehicleId: string,
  revision: number,
  orders: PublishedFinancialOrder[],
  now = new Date(),
): Promise<Map<string, DriverFinancialView>> {
  const ids = orders.map((order) => order.id);
  const sources = new Map(
    (await sourceRows(sql, ids)).map((row) => [row.id, row]),
  );
  const incidents = (
    await sql.query(
      `SELECT i.id,i.shipment_id,i.line_index,i.kind,i.quantity::text,i.status,
    i.financial_revision,i.financial_move_id,i.financial_sale_line_id,i.replacement_payment,r.snapshot AS financial_snapshot
    FROM route_product_incidents i JOIN route_driver_executions e ON e.id=i.execution_id
    JOIN route_shipments s ON s.id=i.shipment_id
    LEFT JOIN route_financial_revisions r ON (r.source,r.picking_id,r.order_id)=(s.source,s.picking_id,s.order_id)
      AND r.revision=i.financial_revision
    WHERE e.plan_id=$1 AND e.vehicle_id=$2 AND e.publication_revision=$3 AND i.shipment_id=ANY($4::uuid[])`,
      [planId, vehicleId, revision, ids],
    )
  ).rows;
  const config = financialSyncConfig();
  return new Map(
    orders.map((order) => {
      const source = sources.get(order.id);
      const records: FinancialIncidentRow[] = incidents
        .filter((row) => row.shipment_id === order.id)
        .map((row) => ({
          id: row.id,
          lineIndex: row.line_index,
          kind: row.kind,
          quantity: row.quantity,
          status: row.status,
          financialRevision: row.financial_revision,
          financialMoveId:
            row.financial_move_id === null
              ? null
              : Number(row.financial_move_id),
          financialSaleLineId:
            row.financial_sale_line_id === null
              ? null
              : Number(row.financial_sale_line_id),
          replacementPayment: row.replacement_payment,
          financialSnapshot: row.financial_snapshot,
        }));
      return [
        order.id,
        projectDriverFinancials({
          revision: source?.revision ?? 0,
          snapshot: source?.financial_snapshot ?? null,
          lastError: source?.last_error ?? null,
          lastSuccessAt: source?.last_success_at ?? null,
          now,
          maxAgeSeconds: config.freshSeconds,
          published: order.lines,
          imported: source?.snapshot.lines ?? [],
          incidents: records,
        }),
      ];
    }),
  );
}

/** Commands call this after lifecycle/order locks; worker only locks financial targets. */
export async function lockIncidentFinancialSource(
  sql: Sql,
  shipmentId: string,
  published: FinancialPublishedLine[],
  lineIndex: number,
  expected: IncidentFinancialReference,
  now = new Date(),
) {
  await sql.query(
    `SELECT t.source FROM route_financial_targets t JOIN route_shipments s
    ON (t.source,t.picking_id,t.order_id)=(s.source,s.picking_id,s.order_id) WHERE s.id=$1 FOR SHARE OF t`,
    [shipmentId],
  );
  const source = (await sourceRows(sql, [shipmentId]))[0];
  if (!source || source.revision !== expected.revision)
    throw new AppError("FINANCIAL_REVISION_CHANGED", 409);
  const snapshot = source.financial_snapshot;
  if (!snapshot || snapshot.status !== "ready")
    throw new AppError("FINANCIAL_SOURCE_NOT_READY", 409);
  const checked = source.last_success_at?.getTime();
  if (
    source.last_error !== null ||
    checked === undefined ||
    now.getTime() < checked ||
    now.getTime() - checked > financialSyncConfig().freshSeconds * 1000
  )
    throw new AppError("FINANCIAL_SOURCE_STALE", 409);
  const identity = financialLineIdentity(
    published,
    source.snapshot.lines,
    snapshot,
  )?.[lineIndex];
  if (
    !identity ||
    identity.id !== expected.moveId ||
    identity.saleLineId !== expected.saleLineId
  )
    throw new AppError("FINANCIAL_LINE_CHANGED", 409);
  return identity;
}

export async function assertUnpricedIncidentSource(
  sql: Sql,
  shipmentId: string,
) {
  await sql.query(
    `SELECT t.source FROM route_financial_targets t JOIN route_shipments s
    ON (t.source,t.picking_id,t.order_id)=(s.source,s.picking_id,s.order_id) WHERE s.id=$1 FOR SHARE OF t`,
    [shipmentId],
  );
  const source = (await sourceRows(sql, [shipmentId]))[0];
  if (source?.financial_snapshot?.status === "ready")
    throw new AppError("FINANCIAL_REFERENCE_REQUIRED", 409);
}

/** Only shipment IDs from an authorized listDriverPlans result are passed here. */
export async function publicationFinancialFingerprint(
  sql: Sql,
  publications: { planId: string; vehicleId: string }[],
  now: Date,
) {
  const rows = (
    await sql.query(
      `SELECT p.plan_id,p.vehicle_id,s.id,t.revision,t.last_error,t.last_success_at,
      s.snapshot->>'fulfillmentStatus' AS fulfillment_status,
      (SELECT jsonb_agg(jsonb_build_array(i.id,i.version) ORDER BY i.id) FROM route_product_incidents i JOIN route_driver_executions e ON e.id=i.execution_id
        WHERE i.shipment_id=s.id AND e.plan_id=p.plan_id AND e.vehicle_id=p.vehicle_id AND e.publication_revision=p.revision) AS incident_versions
    FROM route_plan_publications p CROSS JOIN LATERAL jsonb_array_elements(p.snapshot->'orders') o
    JOIN route_shipments s ON s.id=(o->>'id')::uuid
    LEFT JOIN route_financial_targets t ON (t.source,t.picking_id,t.order_id)=(s.source,s.picking_id,s.order_id)
    WHERE (p.plan_id,p.vehicle_id) IN (SELECT * FROM unnest($1::uuid[],$2::uuid[]))
    ORDER BY p.plan_id,p.vehicle_id,s.id`,
      [
        publications.map((item) => item.planId),
        publications.map((item) => item.vehicleId),
      ],
    )
  ).rows;
  return rows.map((row) => [
    row.plan_id,
    row.vehicle_id,
    row.id,
    row.revision,
    row.last_error,
    row.fulfillment_status,
    row.incident_versions,
    row.last_success_at,
    row.last_success_at !== null &&
      now.getTime() >= row.last_success_at.getTime() &&
      now.getTime() - row.last_success_at.getTime() <=
        financialSyncConfig().freshSeconds * 1000,
  ]);
}
