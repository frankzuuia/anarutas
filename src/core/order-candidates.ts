import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertActiveActor, audit, transaction, type Sql } from "./database";
import { AppError } from "./errors";
import { orderBoard, availableVehicleRows } from "./orders";
import { assertBoundOdooSource, bindOdooSource } from "./odoo-source";
import { importRange, integer, uuid, vehicleIds } from "./orders-validation";
import { ensureCustomerFromShipment } from "./customers";
import { candidateConfig } from "./order-candidates-config";
import {
  lifecycleUpdate,
  parseSelection,
  resolveSelection,
  routingDateEligible,
} from "./order-candidates-validation";
import type {
  Candidate,
  CandidateBatch,
  ConfirmationResult,
  RoutingShipment,
} from "./order-candidates-contract";

export function candidateHash(data: unknown): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
  return createHash("sha256")
    .update(JSON.stringify(canonical(data)))
    .digest("hex");
}
type BatchRow = {
  id: string;
  actor_id: string;
  plan_id: string;
  source: string;
  service_date: string;
  plan_version: number;
  vehicle_ids: string[];
  candidates: Candidate[];
  expires_at: Date;
  consumed_at: Date | null;
  confirmation_hash: string | null;
  receipt: ConfirmationResult | null;
  expired: boolean;
  query_range: { start: string; end: string };
};
async function batchRow(
  sql: Sql,
  id: string,
  actor: string,
  planId: string,
  source: string,
) {
  const { rows } = await sql.query(
    "SELECT *,service_date::text,expires_at<=now() AS expired FROM route_order_batches WHERE id=$1 AND actor_id=$2 AND plan_id=$3 AND source=$4",
    [uuid(id), actor, uuid(planId), source],
  );
  if (!rows[0]) throw new AppError("CANDIDATE_BATCH_INVALID", 404);
  return rows[0] as BatchRow;
}
export async function candidatePreflight(
  pool: Pool,
  planId: string,
  input: Record<string, unknown>,
  timezone: string,
  source: string,
) {
  const range = importRange({ from: input.date, to: input.date }, timezone);
  const chosen = vehicleIds(input.vehicleIds);
  if (!chosen.length) throw new AppError("SELECT_VEHICLES");
  const expectedVersion = integer(input.expectedVersion, 1);
  const board = await orderBoard(pool, planId);
  if (range.to > board.plan.service_date) throw new AppError("INVALID_DATE");
  if (board.plan.version !== expectedVersion)
    throw new AppError("VERSION_CONFLICT", 409);
  await assertBoundOdooSource(pool, source);
  await availableVehicleRows(pool, chosen);
  return { range, chosen, expectedVersion };
}
export async function createCandidateBatch(
  pool: Pool,
  actor: string,
  planId: string,
  input: Record<string, unknown>,
  timezone: string,
  source: string,
  shipments: RoutingShipment[],
  observation: { requestId: string; odooMs: number },
): Promise<CandidateBatch> {
  const { range, chosen, expectedVersion } = await candidatePreflight(
    pool,
    planId,
    input,
    timezone,
    source,
  );
  const limits = candidateConfig();
  if (shipments.length > limits.maxCandidates)
    throw new AppError("CANDIDATES_LIMIT", 422);
  await pool.query(
    "DELETE FROM route_order_batches WHERE expires_at + $1 * interval '1 second' < now()",
    [limits.receiptSeconds],
  );
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const plan = await sql.query(
      "SELECT version FROM route_plans WHERE id=$1 FOR SHARE",
      [planId],
    );
    if (!plan.rows[0]) throw new AppError("NOT_FOUND", 404);
    if (plan.rows[0].version !== expectedVersion)
      throw new AppError("VERSION_CONFLICT", 409);
    await assertBoundOdooSource(pool, source);
    const stored = await sql.query(
      "SELECT picking_id,order_id FROM route_shipments WHERE plan_id=$1 AND source=$2",
      [planId, source],
    );
    const existing = new Set(
      stored.rows.map((s) => `${s.picking_id}:${s.order_id}`),
    );
    const customers = await sql.query(
      "SELECT odoo_partner_id,latitude,longitude,location_status FROM route_customers WHERE source=$1 AND odoo_partner_id=ANY($2::bigint[])",
      [source, shipments.map((s) => s.partnerId)],
    );
    const points = new Set(
      customers.rows
        .filter(
          (c) =>
            c.latitude !== null &&
            c.longitude !== null &&
            c.location_status !== "pending",
        )
        .map((c) => Number(c.odoo_partner_id)),
    );
    const candidates = shipments.map((shipment) => ({
      candidateId: randomUUID(),
      shipment,
      hash: candidateHash(shipment),
      alreadyLoaded: existing.has(`${shipment.pickingId}:${shipment.orderId}`),
      hasCoordinates: points.has(shipment.partnerId),
    }));
    const batchId = randomUUID();
    const result = await sql.query(
      `INSERT INTO route_order_batches(id,actor_id,plan_id,source,service_date,plan_version,vehicle_ids,candidates,query_hash,expires_at,query_range)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+$10*interval '1 second',$11) RETURNING expires_at`,
      [
        batchId,
        actor,
        planId,
        source,
        range.from,
        expectedVersion,
        chosen,
        JSON.stringify(candidates),
        candidateHash({ source, range, expectedVersion, chosen }),
        limits.ttlSeconds,
        JSON.stringify(range),
      ],
    );
    const totals = {
      total: candidates.length,
      validated: shipments.filter((s) => s.fulfillmentStatus === "validated")
        .length,
      pending: shipments.filter(
        (s) => s.fulfillmentStatus === "pending_validation",
      ).length,
      existing: candidates.filter((c) => c.alreadyLoaded).length,
    };
    await audit(sql, actor, "orders.candidates.queried", planId, {
      ...observation,
      source,
      batchId,
      date: range.from,
      ...totals,
    });
    return {
      batchId,
      date: range.from,
      expectedVersion,
      expiresAt: result.rows[0].expires_at.toISOString(),
      candidates,
      ...totals,
    };
  });
}
export async function prepareConfirmation(
  pool: Pool,
  actor: string,
  planId: string,
  source: string,
  input: Record<string, unknown>,
) {
  const row = await batchRow(
    pool,
    String(input.batchId),
    actor,
    planId,
    source,
  );
  const expected = integer(input.expectedVersion, 1),
    chosen = vehicleIds(input.vehicleIds);
  const selection = parseSelection(input.selection);
  const hash = candidateHash({ batchId: row.id, expected, chosen, selection });
  if (row.consumed_at) {
    if (row.confirmation_hash !== hash)
      throw new AppError("CANDIDATE_BATCH_CONSUMED", 409);
    return {
      row,
      chosen,
      hash,
      selected: [] as Candidate[],
      receipt: row.receipt!,
    };
  }
  if (row.expired) throw new AppError("CANDIDATE_BATCH_EXPIRED", 409);
  if (expected !== row.plan_version)
    throw new AppError("VERSION_CONFLICT", 409);
  if (JSON.stringify(chosen) !== JSON.stringify(row.vehicle_ids))
    throw new AppError("CANDIDATE_BATCH_INVALID", 409);
  const selected = resolveSelection(row.candidates, selection);
  const board = await orderBoard(pool, planId);
  if (board.plan.version !== expected)
    throw new AppError("VERSION_CONFLICT", 409);
  await assertBoundOdooSource(pool, source);
  return { row, chosen, hash, selected, receipt: null };
}
export async function persistCandidateSelection(
  pool: Pool,
  actor: string,
  planId: string,
  source: string,
  input: Record<string, unknown>,
  fresh: RoutingShipment[],
  observation: { requestId: string; odooMs: number },
): Promise<ConfirmationResult> {
  const started = performance.now();
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const plan = await sql.query(
      "SELECT version FROM route_plans WHERE id=$1 FOR UPDATE",
      [uuid(planId)],
    );
    if (!plan.rows[0]) throw new AppError("NOT_FOUND", 404);
    await sql.query(
      "SELECT id FROM route_order_batches WHERE id=$1 FOR UPDATE",
      [uuid(input.batchId)],
    );
    const row = await batchRow(
      sql,
      String(input.batchId),
      actor,
      planId,
      source,
    );
    const chosen = vehicleIds(input.vehicleIds),
      expected = integer(input.expectedVersion, 1),
      selection = parseSelection(input.selection);
    const hash = candidateHash({
      batchId: row.id,
      expected,
      chosen,
      selection,
    });
    if (row.consumed_at) {
      if (row.confirmation_hash !== hash)
        throw new AppError("CANDIDATE_BATCH_CONSUMED", 409);
      return row.receipt!;
    }
    if (row.expired) throw new AppError("CANDIDATE_BATCH_EXPIRED", 409);
    if (plan.rows[0].version !== expected || row.plan_version !== expected)
      throw new AppError("VERSION_CONFLICT", 409);
    if (
      !chosen.length ||
      JSON.stringify(chosen) !== JSON.stringify(row.vehicle_ids)
    )
      throw new AppError("CANDIDATE_BATCH_INVALID", 409);
    const selected = resolveSelection(row.candidates, selection);
    const byKey = new Map(fresh.map((s) => [`${s.pickingId}:${s.orderId}`, s]));
    const rejected = selected.filter((c) => {
      const current = byKey.get(
        `${c.shipment.pickingId}:${c.shipment.orderId}`,
      );
      return (
        !current ||
        !routingDateEligible(current, row.query_range) ||
        !["done", "confirmed", "assigned"].includes(current.odooPickingState) ||
        (current.odooPickingState === "done") !==
          (current.fulfillmentStatus === "validated") ||
        !current.lines.length ||
        current.lines.some(
          (l) => !Number.isFinite(l.quantity) || l.quantity <= 0,
        ) ||
        current.partnerId !== c.shipment.partnerId ||
        (c.shipment.fulfillmentStatus === "validated" &&
          current.fulfillmentStatus !== "validated")
      );
    });
    if (
      rejected.length ||
      fresh.length !== selected.length ||
      byKey.size !== fresh.length
    )
      throw new AppError("CANDIDATE_CHANGED", 409, {
        unavailableFolios: rejected.map((c) => c.shipment.orderName),
        rejected: rejected.length,
      });
    const vehicles = await availableVehicleRows(sql, chosen);
    await bindOdooSource(sql, source);
    await sql.query(
      "UPDATE route_shipments SET vehicle_id=NULL WHERE plan_id=$1 AND NOT(vehicle_id=ANY($2::uuid[]))",
      [planId, chosen],
    );
    await sql.query(
      "DELETE FROM route_plan_vehicles WHERE plan_id=$1 AND NOT(vehicle_id=ANY($2::uuid[]))",
      [planId, chosen],
    );
    for (const v of vehicles)
      await sql.query(
        "INSERT INTO route_plan_vehicles(plan_id,vehicle_id,driver_id) VALUES($1,$2,$3) ON CONFLICT(plan_id,vehicle_id) DO NOTHING",
        [planId, v.id, v.driver_id],
      );
    const positionResult = await sql.query(
      "SELECT COALESCE(MAX(position),0)::integer AS n FROM route_shipments WHERE plan_id=$1",
      [planId],
    );
    let position = positionResult.rows[0].n;
    const counts: ConfirmationResult = {
      selected: selected.length,
      inserted: 0,
      existing: 0,
      updated: 0,
      pending: fresh.filter((s) => s.fulfillmentStatus === "pending_validation")
        .length,
      validated: fresh.filter((s) => s.fulfillmentStatus === "validated")
        .length,
      rejected: 0,
      version: expected + 1,
    };
    for (const candidate of selected) {
      const shipment = byKey.get(
        `${candidate.shipment.pickingId}:${candidate.shipment.orderId}`,
      )!;
      const old = await sql.query(
        "SELECT id,snapshot FROM route_shipments WHERE plan_id=$1 AND source=$2 AND picking_id=$3 AND order_id=$4",
        [planId, source, shipment.pickingId, shipment.orderId],
      );
      if (old.rows[0]) {
        const updated = lifecycleUpdate(old.rows[0].snapshot, shipment);
        if (candidateHash(updated) !== candidateHash(old.rows[0].snapshot)) {
          await sql.query(
            "UPDATE route_shipments SET snapshot=$2,snapshot_hash=$3 WHERE id=$1",
            [old.rows[0].id, JSON.stringify(updated), candidateHash(updated)],
          );
          counts.updated++;
        } else counts.existing++;
      } else {
        await ensureCustomerFromShipment(sql, actor, source, shipment);
        await sql.query(
          `INSERT INTO route_shipments(id,source,picking_id,order_id,partner_id,plan_id,position,snapshot,snapshot_hash,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            randomUUID(),
            source,
            shipment.pickingId,
            shipment.orderId,
            shipment.partnerId,
            planId,
            ++position,
            JSON.stringify(shipment),
            candidateHash(shipment),
            actor,
          ],
        );
        counts.inserted++;
      }
    }
    await sql.query(
      "UPDATE route_plans SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1",
      [planId, actor],
    );
    await sql.query(
      "UPDATE route_order_batches SET consumed_at=now(),confirmation_hash=$2,receipt=$3 WHERE id=$1",
      [row.id, hash, JSON.stringify(counts)],
    );
    await audit(sql, actor, "orders.selection.confirmed", planId, {
      ...observation,
      source,
      batchId: row.id,
      date: row.service_date,
      ...counts,
      postgresMs: Math.round(performance.now() - started),
    });
    return counts;
  });
}
