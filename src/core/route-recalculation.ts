import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertActiveActor, audit, transaction } from "./database";
import { AppError } from "./errors";
import { orderBoard, readOrderBoard } from "./orders";
import { getRoutingSettings } from "./routing-settings";
import {
  routeFingerprint,
  vehicleRouteFingerprints,
} from "./route-fingerprint";
import { calculateManualRoutes } from "./route-road";
import { emptyMetrics, type CalculatedRoute } from "./route-road";
import type { OrderBoard } from "./orders-contract";
import type { RouteMetrics } from "./routing-contract";
import { lockRouteInputs, readPlanOptimization } from "./route-optimization";
import { integer, uuid } from "./orders-validation";

export type RecalculationJob = {
  planId: string;
  revision: number;
  actor: string;
  token: string;
  attempts: number;
};
type FrozenRoute = {
  vehicleId: string;
  revision: number;
  snapshotHash: string;
  route: CalculatedRoute;
};

async function startedRoutes(
  pool: Pool,
  planId: string,
): Promise<FrozenRoute[]> {
  const { rows } = await pool.query(
    `SELECT vehicle_id,revision,snapshot_hash,snapshot->'route' AS route
       FROM route_plan_publications WHERE plan_id=$1 AND started_at IS NOT NULL
       ORDER BY vehicle_id`,
    [planId],
  );
  return rows.map((row) => ({
    vehicleId: row.vehicle_id as string,
    revision: Number(row.revision),
    snapshotHash: row.snapshot_hash as string,
    route: row.route as CalculatedRoute,
  }));
}

function mutableBoard(board: OrderBoard, frozen: FrozenRoute[]): OrderBoard {
  const ids = new Set(frozen.map((route) => route.vehicleId));
  return {
    ...board,
    vehicles: board.vehicles.filter((vehicle) => !ids.has(vehicle.id)),
    shipments: board.shipments.filter(
      (shipment) => !shipment.vehicle_id || !ids.has(shipment.vehicle_id),
    ),
  };
}

function combineRoutes(
  board: OrderBoard,
  frozen: FrozenRoute[],
  reused: CalculatedRoute[],
  calculated: Awaited<ReturnType<typeof calculateManualRoutes>>,
) {
  const byVehicle = new Map([
    ...frozen.map((item) => [item.vehicleId, item.route] as const),
    ...reused.map((route) => [route.vehicleId, route] as const),
    ...calculated.routes.map((route) => [route.vehicleId, route] as const),
  ]);
  const routes = board.vehicles.map((vehicle) => byVehicle.get(vehicle.id));
  if (routes.some((route) => !route))
    throw new AppError("ROUTING_RESPONSE_INVALID", 503);
  const metrics = emptyMetrics();
  for (const route of routes)
    for (const key of Object.keys(metrics) as (keyof RouteMetrics)[])
      metrics[key] += route!.metrics[key];
  return { routes: routes as CalculatedRoute[], metrics };
}
export async function claimRecalculation(
  pool: Pool,
  quietSeconds = 1,
): Promise<RecalculationJob | null> {
  const token = randomUUID();
  const { rows } = await pool.query(
    `WITH candidate AS (
    SELECT plan_id FROM route_recalculation_jobs
    WHERE (status='pending' AND available_at<=now()-($2::integer-1)*interval '1 second')
       OR (status='running' AND lease_until<now())
    ORDER BY available_at,plan_id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE route_recalculation_jobs j SET status='running',token=$1,
    lease_until=now()+interval '90 seconds',attempts=attempts+1,updated_at=now()
    FROM candidate c WHERE j.plan_id=c.plan_id RETURNING j.*`,
    [token, quietSeconds],
  );
  const row = rows[0];
  return row
    ? {
        planId: row.plan_id,
        revision: Number(row.revision),
        actor: row.actor_id,
        token,
        attempts: row.attempts,
      }
    : null;
}
export async function renewRecalculation(pool: Pool, job: RecalculationJob) {
  const result = await pool.query(
    "UPDATE route_recalculation_jobs SET lease_until=now()+interval '90 seconds' WHERE plan_id=$1 AND revision=$2 AND token=$3 RETURNING plan_id",
    [job.planId, job.revision, job.token],
  );
  if (!result.rowCount) throw new AppError("VERSION_CONFLICT", 409);
}
export async function finishRecalculation(
  pool: Pool,
  job: RecalculationJob,
  version: number,
  fingerprint: string,
  result: Awaited<ReturnType<typeof calculateManualRoutes>>,
  frozen: FrozenRoute[] = [],
  scope: { recalculatedVehicleIds: string[]; reusedVehicleIds: string[] } = {
    recalculatedVehicleIds: [],
    reusedVehicleIds: [],
  },
) {
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, job.actor);
    await lockRouteInputs(sql, job.planId);
    const board = await readOrderBoard(sql, job.planId),
      settings = await getRoutingSettings(sql);
    if (
      board.plan.version !== version ||
      routeFingerprint(board, settings.version) !== fingerprint
    )
      throw new AppError("VERSION_CONFLICT", 409);
    const currentFrozen = await sql.query(
      `SELECT vehicle_id,revision,snapshot_hash FROM route_plan_publications
       WHERE plan_id=$1 AND started_at IS NOT NULL ORDER BY vehicle_id FOR SHARE`,
      [job.planId],
    );
    if (
      JSON.stringify(
        currentFrozen.rows.map((row) => [
          row.vehicle_id,
          Number(row.revision),
          row.snapshot_hash,
        ]),
      ) !==
      JSON.stringify(
        frozen.map((row) => [row.vehicleId, row.revision, row.snapshotHash]),
      )
    )
      throw new AppError("VERSION_CONFLICT", 409);
    const deleted = await sql.query(
      "DELETE FROM route_recalculation_jobs WHERE plan_id=$1 AND revision=$2 AND token=$3 RETURNING plan_id",
      [job.planId, job.revision, job.token],
    );
    if (!deleted.rowCount) throw new AppError("VERSION_CONFLICT", 409);
    const id = randomUUID();
    const inserted = await sql.query(
      `INSERT INTO route_optimization_runs(id,plan_id,base_plan_version,applied_plan_version,request_hash,input_fingerprint,metrics,routes,skipped,created_by,vehicle_input_hashes)
      VALUES($1,$2,$3,$3,$4,$4,$5,$6,'[]',$7,$8)
      ON CONFLICT(plan_id,base_plan_version,request_hash) DO NOTHING RETURNING id`,
      [
        id,
        job.planId,
        version,
        fingerprint,
        JSON.stringify(result.metrics),
        JSON.stringify(result.routes),
        job.actor,
        JSON.stringify(vehicleRouteFingerprints(board, settings.version)),
      ],
    );
    if (inserted.rowCount) {
      for (const route of result.routes) {
        const stops = route.stops;
        if (stops.length)
          await sql.query(
            `INSERT INTO route_optimization_stops(run_id,shipment_id,vehicle_id,position,eta,travel_distance_meters,travel_duration_seconds,wait_duration_seconds)
          SELECT $1,s.id,$2,s.position,s.eta,s.distance,s.duration,s.wait FROM unnest($3::uuid[],$4::integer[],$5::timestamptz[],$6::integer[],$7::integer[],$8::integer[]) AS s(id,position,eta,distance,duration,wait)`,
            [
              id,
              route.vehicleId,
              stops.map((s) => s.shipmentId),
              stops.map((s) => s.position),
              stops.map((s) => s.eta),
              stops.map((s) => s.travelDistanceMeters),
              stops.map((s) => s.travelDurationSeconds),
              stops.map((s) => s.waitDurationSeconds),
            ],
          );
      }
      await audit(sql, job.actor, "plan.recalculated", job.planId, {
        runId: id,
        version,
        routes: result.routes.length,
        ...scope,
        ...result.metrics,
      });
    }
    return id;
  });
}
export async function failRecalculation(
  pool: Pool,
  job: RecalculationJob,
  error: unknown,
) {
  const code =
    error instanceof AppError ? error.code : "ROUTING_GOOGLE_UNAVAILABLE";
  const retry = [
    "ROUTING_GOOGLE_UNAVAILABLE",
    "ROUTING_GOOGLE_QUOTA",
    "VERSION_CONFLICT",
  ].includes(code);
  const delay = Math.min(300, 2 ** Math.min(job.attempts, 8));
  await pool.query(
    `UPDATE route_recalculation_jobs SET status=$4,error_code=$5,token=NULL,
    available_at=now()+$6::integer*interval '1 second',lease_until=NULL,updated_at=now()
    WHERE plan_id=$1 AND revision=$2 AND token=$3`,
    [
      job.planId,
      job.revision,
      job.token,
      retry ? "pending" : "failed",
      code,
      delay,
    ],
  );
}
export async function retryRecalculation(
  pool: Pool,
  actor: string,
  planId: string,
) {
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    await lockRouteInputs(sql, uuid(planId));
    const prior = await sql.query(
      "SELECT 1 FROM route_optimization_runs WHERE plan_id=$1 LIMIT 1",
      [planId],
    );
    if (!prior.rowCount) throw new AppError("ROUTING_NOT_CALCULATED", 409);
    const active = await sql.query(
      "SELECT status FROM route_recalculation_jobs WHERE plan_id=$1",
      [planId],
    );
    if (
      active.rows[0]?.status !== "pending" &&
      active.rows[0]?.status !== "running"
    )
      await sql.query("SELECT queue_route_recalculation($1,$2)", [
        planId,
        actor,
      ]);
  });
}

export async function manualRecalculationStatus(pool: Pool, planId: string) {
  const id = uuid(planId);
  return transaction(pool, async (sql) => {
    const board = await readOrderBoard(sql, id);
    const optimization = await readPlanOptimization(sql, id);
    const job = await sql.query(
      "SELECT status,error_code FROM route_recalculation_jobs WHERE plan_id=$1",
      [id],
    );
    return {
      version: board.plan.version,
      current: optimization?.current === true,
      status: (job.rows[0]?.status as string | undefined) ?? null,
      errorCode: (job.rows[0]?.error_code as string | undefined) ?? null,
    };
  });
}

export async function requestManualRecalculation(
  pool: Pool,
  actor: string,
  planId: string,
  input: Record<string, unknown>,
  quietSeconds = 1,
) {
  const id = uuid(planId);
  const expected = integer(input.expectedVersion, 1);
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    await lockRouteInputs(sql, id);
    const board = await readOrderBoard(sql, id);
    if (board.plan.version !== expected)
      throw new AppError("VERSION_CONFLICT", 409);
    const optimization = await readPlanOptimization(sql, id);
    if (optimization?.current) return { queued: false, current: true };
    const settings = await getRoutingSettings(sql);
    if (!settings.depotLocation)
      throw new AppError("ROUTING_ORIGIN_REQUIRED", 409);
    if (board.plan.departure_minute == null)
      throw new AppError("ROUTING_DEPARTURE_REQUIRED", 409);
    const started = await sql.query(
      "SELECT vehicle_id FROM route_plan_publications WHERE plan_id=$1 AND started_at IS NOT NULL FOR SHARE",
      [id],
    );
    const frozen = new Set(started.rows.map((row) => String(row.vehicle_id)));
    const mutable = board.shipments.filter(
      (shipment) =>
        shipment.vehicle_id &&
        !frozen.has(shipment.vehicle_id) &&
        shipment.fulfillmentMode === "delivery" &&
        !shipment.customerArchived,
    );
    if (
      mutable.some(
        (shipment) =>
          shipment.latitude === null ||
          shipment.longitude === null ||
          shipment.locationStatus === "pending",
      )
    )
      throw new AppError("ROUTING_POINTS_REQUIRED", 409);
    await sql.query(
      `INSERT INTO route_recalculation_jobs(plan_id,actor_id,status,available_at)
       VALUES($1,$2,'pending',now()-$3::integer*interval '1 second')
       ON CONFLICT(plan_id) DO UPDATE SET
         revision=CASE WHEN route_recalculation_jobs.status='failed'
           THEN route_recalculation_jobs.revision+1 ELSE route_recalculation_jobs.revision END,
         actor_id=EXCLUDED.actor_id,status='pending',token=NULL,attempts=0,
         available_at=EXCLUDED.available_at,lease_until=NULL,error_code=NULL,updated_at=now()
       WHERE route_recalculation_jobs.status IN ('failed','pending')`,
      [id, actor, quietSeconds],
    );
    return { queued: true, current: false };
  });
}
export async function processRecalculation(
  pool: Pool,
  timezone: string,
  quietSeconds = 1,
) {
  const job = await claimRecalculation(pool, quietSeconds);
  if (!job) return false;
  try {
    await assertActiveActor(pool, job.actor);
    const board = await orderBoard(pool, job.planId),
      settings = await getRoutingSettings(pool);
    const fingerprint = routeFingerprint(board, settings.version);
    const frozen = await startedRoutes(pool, job.planId);
    const prior = await pool.query(
      `SELECT routes,vehicle_input_hashes FROM route_optimization_runs
       WHERE plan_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,
      [job.planId],
    );
    const previousHashes = prior.rows[0]?.vehicle_input_hashes as
      Record<string, string> | null | undefined;
    const previousRoutes = new Map<string, CalculatedRoute>(
      ((prior.rows[0]?.routes as CalculatedRoute[] | undefined) ?? []).map(
        (route) => [route.vehicleId, route],
      ),
    );
    const hashes = vehicleRouteFingerprints(board, settings.version);
    const mutable = mutableBoard(board, frozen);
    const reused: CalculatedRoute[] = [];
    const changed = mutable.vehicles.filter((vehicle) => {
      const priorRoute = previousRoutes.get(vehicle.id);
      const currentIds = mutable.shipments
        .filter(
          (shipment) =>
            shipment.vehicle_id === vehicle.id &&
            shipment.fulfillmentMode === "delivery" &&
            !shipment.customerArchived,
        )
        .sort((left, right) => left.position - right.position)
        .map((shipment) => shipment.id);
      const priorIds = priorRoute?.stops.map((stop) => stop.shipmentId);
      if (
        priorRoute &&
        previousHashes?.[vehicle.id] === hashes[vehicle.id] &&
        JSON.stringify(priorIds) === JSON.stringify(currentIds)
      ) {
        reused.push({ ...priorRoute, vehicleName: vehicle.name });
        return false;
      }
      return true;
    });
    const changedIds = new Set(changed.map((vehicle) => vehicle.id));
    const calculated = await calculateManualRoutes(
      {
        ...mutable,
        vehicles: changed,
        shipments: mutable.shipments.filter(
          (shipment) =>
            shipment.vehicle_id && changedIds.has(shipment.vehicle_id),
        ),
      },
      settings,
      timezone,
      () => renewRecalculation(pool, job),
    );
    const result = combineRoutes(board, frozen, reused, calculated);
    await finishRecalculation(
      pool,
      job,
      board.plan.version,
      fingerprint,
      result,
      frozen,
      {
        recalculatedVehicleIds: changed.map((vehicle) => vehicle.id),
        reusedVehicleIds: reused.map((route) => route.vehicleId),
      },
    );
  } catch (error) {
    await failRecalculation(pool, job, error);
  }
  return true;
}
