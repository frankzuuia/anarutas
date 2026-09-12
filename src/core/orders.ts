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
import { bindOdooSource, assertBoundOdooSource } from "./odoo-source";
import { ensureCustomerFromShipment } from "./customers";

async function planRow(
  sql: Sql,
  id: string,
  lock: "UPDATE" | "SHARE",
): Promise<Plan> {
  const { rows } = await sql.query(
    `SELECT id,service_date::text,label,version,updated_at,departure_minute FROM route_plans WHERE id=$1 FOR ${lock}`,
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
export async function availableVehicleRows(sql: Sql, ids: string[]) {
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
  return transaction(pool, (sql) => readOrderBoard(sql, id));
}
export async function readOrderBoard(
  sql: Sql,
  id: string,
): Promise<OrderBoard> {
  const plan = await planRow(sql, id, "SHARE");
  const { rows: vehicles } = await sql.query(
    `SELECT v.*,pv.driver_id,d.name AS driver_name
      FROM route_plan_vehicles pv JOIN route_vehicles v ON v.id=pv.vehicle_id
      LEFT JOIN route_drivers d ON d.id=pv.driver_id WHERE pv.plan_id=$1 ORDER BY v.name,v.id`,
    [id],
  );
  const { rows } = await sql.query(
    `SELECT s.id,s.vehicle_id,s.position,s.snapshot,
              s.window_start::text,s.window_end::text,s.high_priority,
              c.id AS customer_id,c.display_name,c.phone,c.delivery_note,
              c.priority,c.fulfillment_mode,c.delivery_address,c.map_url,
              c.latitude,c.longitude,c.location_status,c.archived_at
       FROM route_shipments s
       LEFT JOIN route_customers c
         ON c.source=s.source AND c.odoo_partner_id=s.partner_id
       WHERE s.plan_id=$1 ORDER BY s.position,s.id`,
    [id],
  );
  const customerIds = rows
    .map((row) => row.customer_id)
    .filter((value): value is string => typeof value === "string");
  const jsDay = new Date(`${plan.service_date}T12:00:00Z`).getUTCDay();
  const day = (jsDay + 6) % 7;
  const { rows: effectiveWindows } = customerIds.length
    ? await sql.query(
        `SELECT customer_id,start_minute,end_minute
           FROM route_customer_windows
           WHERE customer_id=ANY($1::uuid[]) AND (days_mask & $2)<>0
           ORDER BY customer_id,start_minute,end_minute`,
        [customerIds, 1 << day],
      )
    : { rows: [] };
  const windows = new Map<
    string,
    { startMinute: number; endMinute: number }[]
  >();
  for (const window of effectiveWindows) {
    const customerId = String(window.customer_id);
    windows.set(customerId, [
      ...(windows.get(customerId) || []),
      {
        startMinute: Number(window.start_minute),
        endMinute: Number(window.end_minute),
      },
    ]);
  }
  const time = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const shipments: Shipment[] = rows.map(
    ({ snapshot, customer_id: customerId, ...row }) => {
      const deliveryWindows = windows.get(String(customerId)) || [];
      const priority = row.high_priority ? "high" : row.priority || "schedule";
      return {
        odooPickingState: "done",
        fulfillmentStatus: "validated",
        ...snapshot,
        ...row,
        customerName: row.display_name || snapshot.customerName,
        address: row.delivery_address || snapshot.address,
        window_start:
          row.window_start ||
          (deliveryWindows[0] ? time(deliveryWindows[0].startMinute) : null),
        window_end:
          row.window_end ||
          (deliveryWindows[0] ? time(deliveryWindows[0].endMinute) : null),
        high_priority: row.high_priority,
        priority,
        deliveryWindows,
        deliveryNote: row.delivery_note || "",
        phone: row.phone || null,
        fulfillmentMode: row.fulfillment_mode || "delivery",
        mapUrl: row.map_url || null,
        latitude: row.latitude === null ? null : Number(row.latitude),
        longitude: row.longitude === null ? null : Number(row.longitude),
        locationStatus: row.location_status || "pending",
        customerArchived: row.archived_at !== null,
      } as Shipment;
    },
  );
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
  return assertBoundOdooSource(pool, fingerprint);
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
    // The singleton row atomically binds this installation to one Odoo source.
    // Shipment identity is intentionally scoped to each plan by its unique index.
    await bindOdooSource(sql, page.fingerprint);
    const counts = { inserted: 0, existing: 0, changed: 0 };
    const max = await sql.query(
      "SELECT COALESCE(MAX(position),0)::integer AS position FROM route_shipments WHERE plan_id=$1",
      [id],
    );
    let position = max.rows[0].position;
    for (const shipment of page.shipments) {
      await ensureCustomerFromShipment(sql, actor, page.fingerprint, shipment);
      const snapshot = JSON.stringify(shipment);
      const hash = createHash("sha256").update(snapshot).digest("hex");
      const result = await sql.query(
        `INSERT INTO route_shipments(id,source,picking_id,order_id,partner_id,plan_id,position,snapshot,snapshot_hash,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(plan_id,source,picking_id,order_id) DO NOTHING RETURNING id`,
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
          "SELECT snapshot_hash FROM route_shipments WHERE plan_id=$1 AND source=$2 AND picking_id=$3 AND order_id=$4",
          [id, page.fingerprint, shipment.pickingId, shipment.orderId],
        );
        if (previous.rows[0].snapshot_hash !== hash) counts.changed++;
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

export async function removeShipment(
  pool: Pool,
  actor: string,
  id: string,
  input: Record<string, unknown>,
) {
  const shipmentId = uuid(input.shipmentId);
  const expected = integer(input.expectedVersion, 1);
  await transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const plan = await planRow(sql, id, "UPDATE");
    if (plan.version !== expected) throw new AppError("VERSION_CONFLICT", 409);
    const { rows } = await sql.query(
      `SELECT id,vehicle_id,position,snapshot FROM route_shipments
       WHERE plan_id=$1 AND id=$2 FOR UPDATE`,
      [id, shipmentId],
    );
    if (!rows.length) throw new AppError("NOT_FOUND", 404);
    await sql.query("DELETE FROM route_shipments WHERE plan_id=$1 AND id=$2", [
      id,
      shipmentId,
    ]);
    const remaining = await sql.query(
      "SELECT id FROM route_shipments WHERE plan_id=$1 ORDER BY position,id",
      [id],
    );
    await sql.query(
      `UPDATE route_shipments s SET position=o.position
       FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id,position)
       WHERE s.id=o.id AND s.plan_id=$2 AND s.position<>o.position`,
      [remaining.rows.map((row) => row.id), id],
    );
    await bump(sql, id, actor);
    const snapshot = rows[0].snapshot as Record<string, unknown>;
    await audit(sql, actor, "shipment.removed", shipmentId, {
      planId: id,
      orderId: snapshot.orderId,
      pickingId: snapshot.pickingId,
      vehicleId: rows[0].vehicle_id,
    });
  });
}
