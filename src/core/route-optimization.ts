import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertActiveActor, audit, transaction, type Sql } from "./database";
import { AppError } from "./errors";
import { uuid } from "./orders-validation";
import { readOrderBoard } from "./orders";
import type { OrderBoard } from "./orders-contract";
import { routeFingerprint } from "./route-fingerprint";
import type { GoogleOptimizationResult } from "./route-optimization-google";
import type {
  PublicOptimization,
  PublicOptimizedRoute,
  RouteMetrics,
} from "./routing-contract";
import { getRoutingSettings } from "./routing-settings";

type PrivateRoute = PublicOptimizedRoute & {
  transitions: { encodedPolyline: string | null; routeToken: string | null }[];
};

function publicRoutes(value: unknown): PublicOptimizedRoute[] {
  if (!Array.isArray(value)) return [];
  return value.map((value) => {
    const route = value as PrivateRoute;
    return {
      vehicleId: route.vehicleId,
      vehicleName: route.vehicleName,
      encodedPolyline: route.encodedPolyline,
      segmentPolylines:
        route.segmentPolylines ??
        route.transitions
          ?.map((transition) => transition.encodedPolyline)
          .filter((value): value is string => Boolean(value)),
      departureAt: route.departureAt,
      finishedAt: route.finishedAt,
      trafficMode: route.trafficMode,
      metrics: route.metrics,
      stops: route.stops,
    };
  });
}

async function currentRun(
  sql: Sql,
  planId: string,
): Promise<PublicOptimization | null> {
  const { rows } = await sql.query(
    `SELECT r.*,p.version AS current_plan_version
     FROM route_optimization_runs r JOIN route_plans p ON p.id=r.plan_id
     WHERE r.plan_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 1`,
    [uuid(planId)],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  const board = await readOrderBoard(sql, planId);
  const settings = await getRoutingSettings(sql);
  const job = await sql.query(
    "SELECT status,error_code FROM route_recalculation_jobs WHERE plan_id=$1",
    [planId],
  );
  return {
    runId: row.id,
    planId: row.plan_id,
    appliedPlanVersion: Number(row.applied_plan_version),
    current:
      Number(row.applied_plan_version) === board.plan.version &&
      row.input_fingerprint === routeFingerprint(board, settings.version),
    createdAt: new Date(row.created_at).toISOString(),
    metrics: row.metrics as RouteMetrics,
    routes: publicRoutes(row.routes),
    skipped: row.skipped,
    recalculation: job.rows[0]
      ? { status: job.rows[0].status, errorCode: job.rows[0].error_code }
      : null,
  };
}

export async function getPlanOptimization(pool: Pool, planId: string) {
  return transaction(pool, (sql) => currentRun(sql, planId));
}

export async function lockRouteInputs(sql: Sql, planId: string) {
  const plan = await sql.query(
    "SELECT version FROM route_plans WHERE id=$1 FOR UPDATE",
    [uuid(planId)],
  );
  if (!plan.rows[0]) throw new AppError("NOT_FOUND", 404);
  await sql.query(
    "SELECT version FROM route_routing_settings WHERE singleton=true FOR SHARE",
  );
  await sql.query(
    `SELECT c.id FROM route_customers c WHERE EXISTS(
    SELECT 1 FROM route_shipments s WHERE s.plan_id=$1 AND s.source=c.source AND s.partner_id=c.odoo_partner_id
  ) ORDER BY c.id FOR SHARE`,
    [planId],
  );
}

export async function applyOptimizationResult(
  pool: Pool,
  actor: string,
  planId: string,
  expectedVersion: number,
  settingsVersion: number,
  board: OrderBoard,
  deliveryShipments: typeof board.shipments,
  requestHash: string,
  result: GoogleOptimizationResult,
  trace: Record<string, unknown> = {},
) {
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const plan = await sql.query(
      "SELECT version FROM route_plans WHERE id=$1 FOR UPDATE",
      [planId],
    );
    if (!plan.rows[0]) throw new AppError("NOT_FOUND", 404);
    if (Number(plan.rows[0].version) !== expectedVersion)
      throw new AppError("VERSION_CONFLICT", 409);
    const settings = await sql.query(
      "SELECT version FROM route_routing_settings WHERE singleton=true FOR SHARE",
    );
    if (Number(settings.rows[0]?.version) !== settingsVersion)
      throw new AppError("VERSION_CONFLICT", 409);
    await lockRouteInputs(sql, planId);
    if (
      routeFingerprint(await readOrderBoard(sql, planId), settingsVersion) !==
      routeFingerprint(board, settingsVersion)
    )
      throw new AppError("VERSION_CONFLICT", 409);

    const privateRoutes: PrivateRoute[] = [];
    const stopRows: {
      shipmentId: string;
      vehicleId: string;
      position: number;
      eta: string;
      travelDistanceMeters: number;
      travelDurationSeconds: number;
      waitDurationSeconds: number;
    }[] = [];
    for (const route of [...result.routes].sort(
      (a, b) => a.vehicleIndex - b.vehicleIndex,
    )) {
      const vehicle = board.vehicles[route.vehicleIndex];
      const stops = route.visits.map((visit, routePosition) => {
        const shipment = deliveryShipments[visit.shipmentIndex];
        stopRows.push({
          shipmentId: shipment.id,
          vehicleId: vehicle.id,
          position: routePosition + 1,
          eta: visit.eta,
          travelDistanceMeters: visit.travelDistanceMeters,
          travelDurationSeconds: visit.travelDurationSeconds,
          waitDurationSeconds: visit.waitDurationSeconds,
        });
        return {
          shipmentId: shipment.id,
          position: routePosition + 1,
          eta: visit.eta,
          travelDistanceMeters: visit.travelDistanceMeters,
          travelDurationSeconds: visit.travelDurationSeconds,
          waitDurationSeconds: visit.waitDurationSeconds,
        };
      });
      privateRoutes.push({
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        encodedPolyline: route.encodedPolyline,
        departureAt: route.departureAt,
        finishedAt: route.finishedAt,
        metrics: route.metrics,
        stops,
        transitions: route.transitions,
      });
    }
    const skipped = result.skipped.map((item) => ({
      shipmentId: deliveryShipments[item.shipmentIndex].id,
      reasons: item.reasons,
    }));
    const optimizedIds = stopRows.map((stop) => stop.shipmentId);
    const optimizedIdSet = new Set(optimizedIds);
    const remainingIds = board.shipments
      .map((shipment) => shipment.id)
      .filter((id) => !optimizedIdSet.has(id));
    await sql.query(
      "UPDATE route_shipments SET vehicle_id=NULL WHERE plan_id=$1",
      [planId],
    );
    if (stopRows.length)
      await sql.query(
        `UPDATE route_shipments s SET vehicle_id=a.vehicle_id
         FROM unnest($1::uuid[],$2::uuid[]) AS a(shipment_id,vehicle_id)
         WHERE s.plan_id=$3 AND s.id=a.shipment_id`,
        [
          stopRows.map((stop) => stop.shipmentId),
          stopRows.map((stop) => stop.vehicleId),
          planId,
        ],
      );
    const ordered = [...optimizedIds, ...remainingIds];
    await sql.query(
      `UPDATE route_shipments s SET position=o.position
       FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id,position)
       WHERE s.plan_id=$2 AND s.id=o.id`,
      [ordered, planId],
    );
    const appliedVersion = expectedVersion + 1;
    await sql.query(
      "UPDATE route_plans SET version=$2,updated_by=$3,updated_at=now() WHERE id=$1",
      [planId, appliedVersion, actor],
    );
    const runId = randomUUID();
    const inserted = await sql.query(
      `INSERT INTO route_optimization_runs(
         id,plan_id,base_plan_version,applied_plan_version,request_hash,metrics,routes,skipped,created_by,input_fingerprint
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(plan_id,base_plan_version,request_hash) DO NOTHING RETURNING id`,
      [
        runId,
        planId,
        expectedVersion,
        appliedVersion,
        requestHash,
        JSON.stringify(result.metrics),
        JSON.stringify(privateRoutes),
        JSON.stringify(skipped),
        actor,
        routeFingerprint(await readOrderBoard(sql, planId), settingsVersion),
      ],
    );
    if (!inserted.rowCount) throw new AppError("VERSION_CONFLICT", 409);
    if (stopRows.length)
      await sql.query(
        `INSERT INTO route_optimization_stops(
           run_id,shipment_id,vehicle_id,position,eta,travel_distance_meters,
           travel_duration_seconds,wait_duration_seconds
         ) SELECT $1,s.shipment_id,s.vehicle_id,s.position,s.eta,
                  s.travel_distance_meters,s.travel_duration_seconds,
                  s.wait_duration_seconds
           FROM unnest(
             $2::uuid[],$3::uuid[],$4::integer[],$5::timestamptz[],
             $6::integer[],$7::integer[],$8::integer[]
           ) AS s(
             shipment_id,vehicle_id,position,eta,travel_distance_meters,
             travel_duration_seconds,wait_duration_seconds
           )`,
        [
          runId,
          stopRows.map((stop) => stop.shipmentId),
          stopRows.map((stop) => stop.vehicleId),
          stopRows.map((stop) => stop.position),
          stopRows.map((stop) => stop.eta),
          stopRows.map((stop) => stop.travelDistanceMeters),
          stopRows.map((stop) => stop.travelDurationSeconds),
          stopRows.map((stop) => stop.waitDurationSeconds),
        ],
      );
    await audit(sql, actor, "plan.optimized", planId, {
      runId,
      basePlanVersion: expectedVersion,
      appliedPlanVersion: appliedVersion,
      routes: privateRoutes.length,
      assigned: stopRows.length,
      skipped: skipped.length,
      travelDistanceMeters: result.metrics.travelDistanceMeters,
      totalDurationSeconds: result.metrics.totalDurationSeconds,
      ...trace,
    });
    await sql.query("DELETE FROM route_recalculation_jobs WHERE plan_id=$1", [
      planId,
    ]);
    return currentRun(sql, planId);
  });
}
