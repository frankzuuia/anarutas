import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "./errors";
import { assertActiveActor, audit, transaction, type Sql } from "./database";
import { integer, uuid, vehicleIds } from "./orders-validation";
import type {
  ImportPage,
  ImportResult,
  OrderBoard,
  Shipment,
} from "./orders-contract";
import type { Plan } from "./plans";

async function planRow(
  sql: Sql,
  id: string,
  lock: "UPDATE" | "SHARE",
): Promise<Plan> {
  const { rows } = await sql.query(
    `SELECT id,service_date::text,label,version,updated_at FROM route_plans WHERE id=$1 FOR ${lock}`,
    [uuid(id)],
  );
  if (!rows.length) throw new AppError("NOT_FOUND", 404);
  return rows[0];
}
async function bump(sql: Sql, planId: string, actor: string) {
  await sql.query(
    "UPDATE route_plans SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1",
    [planId, actor],
  );
}
async function availableVehicleRows(sql: Sql, ids: string[]) {
  const { rows: chosen } = await sql.query(
    "SELECT id,driver_id,available FROM route_vehicles WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
    [ids],
  );
  if (chosen.length !== ids.length || chosen.some((v) => !v.available))
    throw new AppError("FLEET_UNAVAILABLE", 409);
  const driverIds = chosen.map((v) => v.driver_id).filter(Boolean);
  const { rows: drivers } = await sql.query(
    "SELECT id,active FROM route_drivers WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
    [driverIds],
  );
  if (drivers.some((d) => !d.active))
    throw new AppError("FLEET_UNAVAILABLE", 409);
  return chosen;
}
export async function orderBoard(pool: Pool, id: string): Promise<OrderBoard> {
  return transaction(pool, async (sql) => {
    const plan = await planRow(sql, id, "SHARE");
    const { rows: vehicles } = await sql.query(
      `SELECT v.*,pv.driver_id,d.name AS driver_name
      FROM route_plan_vehicles pv JOIN route_vehicles v ON v.id=pv.vehicle_id
      LEFT JOIN route_drivers d ON d.id=pv.driver_id WHERE pv.plan_id=$1 ORDER BY v.name,v.id`,
      [id],
    );
    const { rows } = await sql.query(
      "SELECT id,vehicle_id,position,snapshot,window_start::text,window_end::text,high_priority FROM route_shipments WHERE plan_id=$1 ORDER BY position,id",
      [id],
    );
    const shipments: Shipment[] = rows.map(({ snapshot, ...row }) => ({
      ...snapshot,
      ...row,
    }));
    // Do not send creation_payload or private metadata from the fleet tables.
    return {
      plan,
      shipments,
      vehicles: vehicles.map((v) => ({
        id: v.id,
        name: v.name,
        brand: v.brand,
        model: v.model,
        plate: v.plate,
        mileage: v.mileage,
        fuel: v.fuel,
        available: v.available,
        driver_id: v.driver_id,
        driver_name: v.driver_name,
        version: v.version,
      })),
    };
  });
}
export async function selectPlanVehicles(
  pool: Pool,
  actor: string,
  id: string,
  input: Record<string, unknown>,
) {
  const ids = vehicleIds(input.vehicleIds);
  const expected = integer(input.expectedVersion, 1);
  await transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const plan = await planRow(sql, id, "UPDATE");
    if (plan.version !== expected) throw new AppError("VERSION_CONFLICT", 409);
    const chosen = await availableVehicleRows(sql, ids);
    const { rows: previous } = await sql.query(
      "SELECT vehicle_id FROM route_plan_vehicles WHERE plan_id=$1 ORDER BY vehicle_id",
      [id],
    );
    if (
      JSON.stringify(previous.map((v) => v.vehicle_id)) === JSON.stringify(ids)
    )
      return;
    await sql.query(
      "UPDATE route_shipments SET vehicle_id=NULL WHERE plan_id=$1 AND NOT(vehicle_id=ANY($2::uuid[]))",
      [id, ids],
    );
    await sql.query(
      "DELETE FROM route_plan_vehicles WHERE plan_id=$1 AND NOT(vehicle_id=ANY($2::uuid[]))",
      [id, ids],
    );
    for (const v of chosen)
      await sql.query(
        "INSERT INTO route_plan_vehicles(plan_id,vehicle_id,driver_id) VALUES($1,$2,$3) ON CONFLICT(plan_id,vehicle_id) DO NOTHING",
        [id, v.id, v.driver_id],
      );
    await bump(sql, id, actor);
    await audit(sql, actor, "plan.vehicles.selected", id, {
      count: ids.length,
    });
  });
}
export async function addPlanVehicles(
  pool: Pool,
  actor: string,
  id: string,
  input: Record<string, unknown>,
) {
  const ids = vehicleIds(input.vehicleIds);
  if (!ids.length) throw new AppError("SELECT_VEHICLES");
  const expected = integer(input.expectedVersion, 1);
  await transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const plan = await planRow(sql, id, "UPDATE");
    if (plan.version !== expected) throw new AppError("VERSION_CONFLICT", 409);
    await availableVehicleRows(sql, ids);
    const result = await sql.query(
      `INSERT INTO route_plan_vehicles(plan_id,vehicle_id,driver_id)
       SELECT $1,id,driver_id FROM route_vehicles WHERE id=ANY($2::uuid[])
       ON CONFLICT(plan_id,vehicle_id) DO NOTHING RETURNING vehicle_id`,
      [id, ids],
    );
    const added = result.rowCount ?? 0;
    if (!added) return;
    await bump(sql, id, actor);
    await audit(sql, actor, "plan.vehicles.added", id, { count: added });
  });
}
export async function removePlanVehicle(
  pool: Pool,
  actor: string,
  id: string,
  input: Record<string, unknown>,
) {
  const vehicleId = uuid(input.vehicleId);
  const expected = integer(input.expectedVersion, 1);
  await transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const plan = await planRow(sql, id, "UPDATE");
    if (plan.version !== expected) throw new AppError("VERSION_CONFLICT", 409);
    const membership = await sql.query(
      "SELECT vehicle_id FROM route_plan_vehicles WHERE plan_id=$1 AND vehicle_id=$2 FOR UPDATE",
      [id, vehicleId],
    );
    if (!membership.rowCount) throw new AppError("PLAN_VEHICLE_NOT_FOUND", 404);
    const unassigned = await sql.query(
      "UPDATE route_shipments SET vehicle_id=NULL WHERE plan_id=$1 AND vehicle_id=$2 RETURNING id",
      [id, vehicleId],
    );
    await sql.query(
      "DELETE FROM route_plan_vehicles WHERE plan_id=$1 AND vehicle_id=$2",
      [id, vehicleId],
    );
    await bump(sql, id, actor);
    await audit(sql, actor, "plan.vehicle.removed", id, {
      vehicleId,
      unassigned: unassigned.rowCount ?? 0,
    });
  });
}
export async function assertOrderSource(pool: Pool, fingerprint: string) {
  const { rows } = await pool.query(
    "SELECT fingerprint FROM route_order_source",
  );
  if (rows.length && rows[0].fingerprint !== fingerprint)
    throw new AppError("ODOO_SOURCE_CHANGED", 409);
}
export async function persistImportPage(
  pool: Pool,
  actor: string,
  id: string,
  page: ImportPage,
): Promise<ImportResult> {
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    await planRow(sql, id, "UPDATE");
    // Serialize source binding and global shipment identity across different plans.
    await sql.query(
      "SELECT pg_advisory_xact_lock(hashtext('ana-rutas:order-source'))",
    );
    await sql.query(
      "INSERT INTO route_order_source(singleton,fingerprint) VALUES(true,$1) ON CONFLICT(singleton) DO NOTHING",
      [page.fingerprint],
    );
    const source = await sql.query(
      "SELECT fingerprint FROM route_order_source WHERE singleton=true",
      [],
    );
    if (source.rows[0].fingerprint !== page.fingerprint)
      throw new AppError("ODOO_SOURCE_CHANGED", 409);
    const counts = { inserted: 0, existing: 0, otherPlan: 0, changed: 0 };
    const max = await sql.query(
      "SELECT COALESCE(MAX(position),0)::integer AS position FROM route_shipments WHERE plan_id=$1",
      [id],
    );
    let position = max.rows[0].position;
    for (const shipment of page.shipments) {
      const snapshot = JSON.stringify(shipment);
      const hash = createHash("sha256").update(snapshot).digest("hex");
      const result = await sql.query(
        `INSERT INTO route_shipments(id,source,picking_id,order_id,partner_id,plan_id,position,snapshot,snapshot_hash,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(source,picking_id,order_id) DO NOTHING RETURNING id`,
        [
          randomUUID(),
          page.fingerprint,
          shipment.pickingId,
          shipment.orderId,
          shipment.partnerId,
          id,
          position + 1,
          snapshot,
          hash,
          actor,
        ],
      );
      if (result.rowCount) {
        counts.inserted++;
        position++;
      } else {
        const previous = await sql.query(
          "SELECT plan_id,snapshot_hash FROM route_shipments WHERE source=$1 AND picking_id=$2 AND order_id=$3",
          [page.fingerprint, shipment.pickingId, shipment.orderId],
        );
        if (previous.rows[0].plan_id !== id) counts.otherPlan++;
        else if (previous.rows[0].snapshot_hash !== hash) counts.changed++;
        else counts.existing++;
      }
    }
    if (counts.inserted) await bump(sql, id, actor);
    await audit(sql, actor, "orders.imported", id, {
      ...counts,
      inspected: page.inspected,
      excluded: page.excluded,
    });
    return {
      ...counts,
      inspected: page.inspected,
      excluded: page.excluded,
      nextCursor: page.nextCursor,
      ceiling: page.ceiling,
      hasMore: page.hasMore,
    };
  });
}
export async function moveShipment(
  pool: Pool,
  actor: string,
  id: string,
  input: Record<string, unknown>,
) {
  const shipmentId = uuid(input.shipmentId);
  const vehicleId = input.vehicleId === null ? null : uuid(input.vehicleId);
  const beforeId = input.beforeId == null ? null : uuid(input.beforeId);
  const expected = integer(input.expectedVersion, 1);
  await transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const plan = await planRow(sql, id, "UPDATE");
    if (plan.version !== expected) throw new AppError("VERSION_CONFLICT", 409);
    if (vehicleId) {
      const { rows } = await sql.query(
        `SELECT v.available FROM route_plan_vehicles pv JOIN route_vehicles v ON v.id=pv.vehicle_id
        WHERE pv.plan_id=$1 AND pv.vehicle_id=$2 FOR SHARE OF v`,
        [id, vehicleId],
      );
      if (!rows[0]?.available) throw new AppError("FLEET_UNAVAILABLE", 409);
    }
    const { rows } = await sql.query(
      "SELECT id,vehicle_id FROM route_shipments WHERE plan_id=$1 ORDER BY position,id",
      [id],
    );
    if (!rows.some((s) => s.id === shipmentId))
      throw new AppError("NOT_FOUND", 404);
    if (beforeId === shipmentId) return;
    const ordered = rows.filter((s) => s.id !== shipmentId);
    if (
      beforeId &&
      !ordered.some((s) => s.id === beforeId && s.vehicle_id === vehicleId)
    )
      throw new AppError("INVALID_INPUT");
    const index = beforeId
      ? ordered.findIndex((s) => s.id === beforeId)
      : ordered.length;
    ordered.splice(index, 0, { id: shipmentId, vehicle_id: vehicleId });
    await sql.query("UPDATE route_shipments SET vehicle_id=$2 WHERE id=$1", [
      shipmentId,
      vehicleId,
    ]);
    await sql.query(
      `UPDATE route_shipments s SET position=o.position FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id,position)
      WHERE s.id=o.id AND s.plan_id=$2 AND s.position<>o.position`,
      [ordered.map((s) => s.id), id],
    );
    await bump(sql, id, actor);
    await audit(sql, actor, "shipment.moved", shipmentId, {
      planId: id,
      vehicleId,
      beforeId,
    });
  });
}
