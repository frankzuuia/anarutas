import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { assertActiveActor, audit, transaction, type Sql } from "./database";
import { AppError } from "./errors";
import { readOrderBoard } from "./orders";
import { integer, uuid } from "./orders-validation";
import { routeFingerprint } from "./route-fingerprint";
import { readPlanOptimization, lockRouteInputs } from "./route-optimization";
import { getRoutingSettings } from "./routing-settings";

type PublicationRow = {
  vehicle_id: string;
  driver_id: string;
  revision: number;
  source_plan_version: number;
  published_at: Date;
  started_at: Date | null;
};

export async function listRoutePublications(sql: Sql, planId: string) {
  const { rows } = await sql.query(
    `SELECT vehicle_id,driver_id,revision,source_plan_version,published_at,started_at
       FROM route_plan_publications WHERE plan_id=$1 ORDER BY vehicle_id`,
    [uuid(planId)],
  );
  return rows as PublicationRow[];
}

export async function publishRoutes(
  pool: Pool,
  actor: string,
  planId: string,
  input: Record<string, unknown>,
) {
  const id = uuid(planId);
  const expectedVersion = integer(input.expectedVersion, 1);
  const scope = input.scope;
  if (scope !== "all" && scope !== "vehicle")
    throw new AppError("INVALID_INPUT");
  const requestedVehicleId = scope === "vehicle" ? uuid(input.vehicleId) : null;
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const plan = await sql.query(
      "SELECT version FROM route_plans WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!plan.rowCount) throw new AppError("NOT_FOUND", 404);
    if (Number(plan.rows[0].version) !== expectedVersion)
      throw new AppError("VERSION_CONFLICT", 409);
    await lockRouteInputs(sql, id);
    const board = await readOrderBoard(sql, id);
    const selected = requestedVehicleId
      ? board.vehicles.filter((vehicle) => vehicle.id === requestedVehicleId)
      : board.vehicles;
    if (requestedVehicleId && !selected.length)
      throw new AppError("PLAN_VEHICLE_NOT_FOUND", 404);

    const membership = await sql.query(
      `SELECT pv.vehicle_id,pv.driver_id,v.driver_id AS fleet_driver_id,
              v.available,d.active AS driver_active
         FROM route_plan_vehicles pv
         JOIN route_vehicles v ON v.id=pv.vehicle_id
         LEFT JOIN route_drivers d ON d.id=v.driver_id
        WHERE pv.plan_id=$1 AND pv.vehicle_id=ANY($2::uuid[])
        ORDER BY pv.vehicle_id FOR SHARE OF pv,v`,
      [id, selected.map((vehicle) => vehicle.id)],
    );
    const assignment = new Map<string, (typeof membership.rows)[number]>(
      membership.rows.map((row) => [row.vehicle_id as string, row]),
    );
    const prior = await sql.query(
      `SELECT vehicle_id,driver_id,revision,snapshot_hash,started_at
         FROM route_plan_publications WHERE plan_id=$1 ORDER BY vehicle_id FOR UPDATE`,
      [id],
    );
    const published = new Map<string, (typeof prior.rows)[number]>(
      prior.rows.map((row) => [row.vehicle_id as string, row]),
    );
    const active = selected.filter(
      (vehicle) => !published.get(vehicle.id)?.started_at,
    );
    if (requestedVehicleId && active.length === 0)
      throw new AppError("ROUTE_ALREADY_STARTED", 409);
    const withOrders = active.filter((vehicle) =>
      board.shipments.some((shipment) => shipment.vehicle_id === vehicle.id),
    );
    const optimization = withOrders.length
      ? await readPlanOptimization(sql, id)
      : null;
    if (withOrders.length && !optimization?.current)
      throw new AppError("ROUTE_NOT_CURRENT", 409);

    const changes: { vehicleId: string; revision: number; action: string }[] = [];
    let assignmentChanged = false;
    for (const vehicle of active) {
      const own = board.shipments.filter(
        (shipment) => shipment.vehicle_id === vehicle.id,
      );
      const previous = published.get(vehicle.id);
      if (!own.length) {
        if (previous) {
          await sql.query(
            "DELETE FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2",
            [id, vehicle.id],
          );
          changes.push({
            vehicleId: vehicle.id,
            revision: Number(previous.revision),
            action: "unpublished",
          });
        }
        continue;
      }
      const currentAssignment = assignment.get(vehicle.id);
      if (
        !currentAssignment?.fleet_driver_id ||
        !currentAssignment.available ||
        !currentAssignment.driver_active
      )
        throw new AppError("FLEET_UNAVAILABLE", 409);
      const route = optimization!.routes.find(
        (candidate) => candidate.vehicleId === vehicle.id,
      );
      const ids = new Set(own.map((shipment) => shipment.id));
      if (
        !route ||
        route.stops.length !== own.length ||
        route.stops.some((stop) => !ids.delete(stop.shipmentId))
      )
        throw new AppError("ROUTE_INCOMPLETE", 409);
      if (currentAssignment.driver_id !== currentAssignment.fleet_driver_id) {
        await sql.query(
          `UPDATE route_plan_vehicles SET driver_id=$3
           WHERE plan_id=$1 AND vehicle_id=$2`,
          [id, vehicle.id, currentAssignment.fleet_driver_id],
        );
        assignmentChanged = true;
      }
      const snapshot = {
        plan: {
          id: board.plan.id,
          label: board.plan.label,
          serviceDate: board.plan.service_date,
          version: board.plan.version,
        },
        vehicle: {
          id: vehicle.id,
          name: vehicle.name,
          plate: vehicle.plate,
        },
        orders: own.map((shipment) => ({
          id: shipment.id,
          orderName: shipment.orderName,
          customerName: shipment.customerName,
          address: shipment.address,
          position: shipment.position,
          phone: shipment.phone,
          priority: shipment.priority,
          deliveryWindows: shipment.deliveryWindows,
          deliveryNote: shipment.deliveryNote,
          fulfillmentMode: shipment.fulfillmentMode,
          latitude: shipment.latitude,
          longitude: shipment.longitude,
          locationStatus: shipment.locationStatus,
          lines: shipment.lines.map((line) => ({
            name: line.name,
            quantity: line.quantity,
            unit: line.unit,
            pickerNote: line.pickerNote ?? null,
          })),
        })),
        routeStatus: "current",
        route,
      };
      const serialized = JSON.stringify(snapshot);
      const hash = createHash("sha256").update(serialized).digest("hex");
      if (
        previous?.snapshot_hash === hash &&
        previous.driver_id === currentAssignment.fleet_driver_id
      )
        continue;
      const saved = await sql.query(
        `INSERT INTO route_plan_publications
           (plan_id,vehicle_id,driver_id,source_plan_version,snapshot,snapshot_hash,published_by)
         VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)
         ON CONFLICT(plan_id,vehicle_id) DO UPDATE SET
           driver_id=EXCLUDED.driver_id,
           revision=route_plan_publications.revision+1,
           source_plan_version=EXCLUDED.source_plan_version,
           snapshot=EXCLUDED.snapshot,
           snapshot_hash=EXCLUDED.snapshot_hash,
           published_by=EXCLUDED.published_by,
           published_at=now()
         WHERE route_plan_publications.started_at IS NULL
         RETURNING revision`,
        [
          id,
          vehicle.id,
          currentAssignment.fleet_driver_id,
          board.plan.version,
          serialized,
          hash,
          actor,
        ],
      );
      if (!saved.rowCount) throw new AppError("ROUTE_ALREADY_STARTED", 409);
      changes.push({
        vehicleId: vehicle.id,
        revision: Number(saved.rows[0].revision),
        action: "published",
      });
    }
    if (assignmentChanged && optimization) {
      const settings = await getRoutingSettings(sql);
      const fingerprint = routeFingerprint(await readOrderBoard(sql, id), settings.version);
      await sql.query(
        "UPDATE route_optimization_runs SET input_fingerprint=$2 WHERE id=$1",
        [optimization.runId, fingerprint],
      );
    }
    if (changes.length)
      await audit(sql, actor, "route.publication.changed", id, {
        changes,
        sourcePlanVersion: board.plan.version,
      });
    return { changes, publications: await listRoutePublications(sql, id) };
  });
}
