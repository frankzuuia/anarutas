import type { Sql } from "./database";
import { audit } from "./database";
import { AppError } from "./errors";
import type { FinancialSnapshot } from "./financial-contract";
import { financialHash } from "./financial-policy";
import type { SourceShipment, ShipmentLine } from "./orders-contract";

/** Same observation as finance; never a second remote read or a name-based match. */
export function observedDraftShipment(
  previous: SourceShipment,
  snapshot: FinancialSnapshot,
): SourceShipment {
  const { target, picking, observation } = snapshot;
  if (
    previous.pickingId !== target.pickingId ||
    previous.orderId !== target.orderId ||
    previous.partnerId !== target.partnerId ||
    picking.partnerId !== target.partnerId
  )
    throw new AppError("FINANCIAL_IDENTITY_CHANGED", 409);
  const canceled =
    picking.state === "cancel" || observation.order.state === "cancel";
  const done = picking.state === "done" && picking.validatedAt !== null;
  const old = new Map(
    previous.lines.map((line, index) => [line.moveId, { line, index }]),
  );
  const lines: ShipmentLine[] = observation.moves
    .filter(
      (move) =>
        !canceled &&
        move.pickingId === target.pickingId &&
        move.state !== "cancel",
    )
    .sort(
      (a, b) =>
        (old.get(a.id)?.index ?? previous.lines.length) -
          (old.get(b.id)?.index ?? previous.lines.length) || a.id - b.id,
    )
    .flatMap((move) => {
      const quantity = Number(done ? move.quantity : move.demand);
      if (!Number.isFinite(quantity) || quantity < 0)
        throw new AppError("ODOO_FINANCIAL_INVALID_RESPONSE", 502);
      if (quantity === 0) return [];
      const known = old.get(move.id)?.line;
      const sameProduct = known?.productId === move.productId;
      const sale = observation.saleLines.find(
        (line) =>
          line.id === move.saleLineId && line.productId === move.productId,
      );
      const name = sameProduct ? known.name : move.productName || sale?.name;
      if (!name) throw new AppError("ODOO_FINANCIAL_INVALID_RESPONSE", 502);
      return [
        {
          moveId: move.id,
          productId: move.productId,
          name,
          quantity,
          unit: move.uom,
          uomId: move.uomId,
          ...(move.saleLineId === null ? {} : { saleLineId: move.saleLineId }),
          ...(sameProduct && known.pickerNote
            ? { pickerNote: known.pickerNote }
            : {}),
        },
      ];
    });
  return {
    ...previous,
    odooPickingState: picking.state,
    fulfillmentStatus: canceled
      ? "cancelled"
      : done
        ? "validated"
        : "pending_validation",
    validatedAt: picking.validatedAt,
    sourceUpdatedAt: picking.writeDate,
    lines,
  };
}

/** Lock all plans before any target in a batch: plan → target, matching mobile commands. */
export async function lockDraftSourcePlans(
  sql: Sql,
  snapshots: FinancialSnapshot[],
) {
  const { rows } = await sql.query<{ id: string }>(
    `SELECT p.id FROM route_plans p WHERE p.archived_at IS NULL AND EXISTS (
      SELECT 1 FROM route_shipments s WHERE s.plan_id=p.id AND (s.source,s.picking_id,s.order_id) IN
        (SELECT * FROM unnest($1::text[],$2::bigint[],$3::bigint[]))) ORDER BY p.id FOR UPDATE`,
    [
      snapshots.map((s) => s.target.source),
      snapshots.map((s) => s.target.pickingId),
      snapshots.map((s) => s.target.orderId),
    ],
  );
  return rows.map((row) => row.id);
}

/** Caller holds every batch plan lock. Started lanes are immutable, including revoked history. */
export async function refreshDraftSourceShipments(
  sql: Sql,
  snapshots: FinancialSnapshot[],
  planIds: string[],
) {
  let updated = 0;
  const changedPlans = new Map<string, string[]>();
  for (const snapshot of snapshots) {
    const { target } = snapshot;
    const { rows } = await sql.query<{
      id: string;
      plan_id: string;
      snapshot: SourceShipment;
    }>(
      `SELECT s.id,s.plan_id,s.snapshot FROM route_shipments s WHERE s.plan_id=ANY($1::uuid[])
       AND (s.source,s.picking_id,s.order_id)=($2,$3,$4) AND NOT EXISTS (
         SELECT 1 FROM route_plan_publications pub WHERE pub.plan_id=s.plan_id AND pub.vehicle_id=s.vehicle_id AND pub.started_at IS NOT NULL)
       ORDER BY s.plan_id,s.id FOR UPDATE OF s`,
      [planIds, target.source, target.pickingId, target.orderId],
    );
    for (const row of rows) {
      const next = observedDraftShipment(row.snapshot, snapshot),
        hash = financialHash(next);
      if (hash === financialHash(row.snapshot)) continue;
      await sql.query(
        "UPDATE route_shipments SET snapshot=$2,snapshot_hash=$3 WHERE id=$1",
        [row.id, JSON.stringify(next), hash],
      );
      changedPlans.set(row.plan_id, [
        ...(changedPlans.get(row.plan_id) ?? []),
        row.id,
      ]);
      updated++;
    }
  }
  for (const [planId, shipmentIds] of changedPlans) {
    await sql.query(
      "UPDATE route_plans SET version=version+1,updated_at=now() WHERE id=$1",
      [planId],
    );
    await audit(sql, null, "orders.source_refreshed", planId, { shipmentIds });
  }
  return updated;
}
