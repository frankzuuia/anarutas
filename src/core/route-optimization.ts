import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertActiveActor, audit, transaction, type Sql } from "./database";
import { AppError } from "./errors";
import { integer, uuid } from "./orders-validation";
import { orderBoard } from "./orders";
import {
  buildGoogleOptimizationRequest,
  parseGoogleOptimizationResponse,
  requestGoogleOptimization,
  type GoogleOptimizationResult,
} from "./route-optimization-google";
import { readGoogleRoutingConfig } from "./routing-config";
import type {
  PublicOptimization,
  PublicOptimizedRoute,
  RouteMetrics,
} from "./routing-contract";
import { getRoutingSettings } from "./routing-settings";
import {
  acquireOptimizationLease,
  releaseOptimizationLease,
} from "./route-optimization-lease";

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
  return {
    runId: row.id,
    planId: row.plan_id,
    appliedPlanVersion: Number(row.applied_plan_version),
    current:
      Number(row.applied_plan_version) === Number(row.current_plan_version),
    createdAt: new Date(row.created_at).toISOString(),
    metrics: row.metrics as RouteMetrics,
    routes: publicRoutes(row.routes),
    skipped: row.skipped,
  };
}

export async function getPlanOptimization(pool: Pool, planId: string) {
  return currentRun(pool, planId);
}

export async function applyOptimizationResult(
  pool: Pool,
  actor: string,
  planId: string,
  expectedVersion: number,
  settingsVersion: number,
  board: Awaited<ReturnType<typeof orderBoard>>,
  deliveryShipments: typeof board.shipments,
  requestHash: string,
  result: GoogleOptimizationResult,
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
         id,plan_id,base_plan_version,applied_plan_version,request_hash,metrics,routes,skipped,created_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
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
    });
    return currentRun(sql, planId);
  });
}

export async function optimizePlan(
  pool: Pool,
  actor: string,
  planId: string,
  input: Record<string, unknown>,
  timezone: string,
  dependencies?: Parameters<typeof requestGoogleOptimization>[3],
) {
  const expectedVersion = integer(input.expectedVersion, 1);
  await assertActiveActor(pool, actor);
  const [board, settings] = await Promise.all([
    orderBoard(pool, planId),
    getRoutingSettings(pool),
  ]);
  if (board.plan.version !== expectedVersion)
    throw new AppError("VERSION_CONFLICT", 409);
  const request = buildGoogleOptimizationRequest(board, settings, timezone);
  const deliveryShipments = board.shipments.filter(
    (shipment) =>
      shipment.fulfillmentMode === "delivery" && !shipment.customerArchived,
  );
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        request,
        settingsVersion: settings.version,
        expectedVersion,
      }),
    )
    .digest("hex");
  const config = readGoogleRoutingConfig();
  const timeoutSeconds = Number(request.timeout.slice(0, -1));
  const lease = await acquireOptimizationLease(
    pool,
    planId,
    expectedVersion,
    requestHash,
    timeoutSeconds,
  );
  try {
    const raw = await requestGoogleOptimization(
      config.projectId,
      config.credentials,
      request,
      dependencies,
    );
    const result = parseGoogleOptimizationResponse(
      raw,
      deliveryShipments.length,
      board.vehicles.length,
    );
    return await applyOptimizationResult(
      pool,
      actor,
      planId,
      expectedVersion,
      settings.version,
      board,
      deliveryShipments,
      requestHash,
      result,
    );
  } finally {
    await releaseOptimizationLease(pool, planId, lease).catch(() => {});
  }
}
