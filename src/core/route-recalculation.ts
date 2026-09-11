import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertActiveActor, audit, transaction } from "./database";
import { AppError } from "./errors";
import { orderBoard, readOrderBoard } from "./orders";
import { getRoutingSettings } from "./routing-settings";
import { routeFingerprint } from "./route-fingerprint";
import { calculateManualRoutes } from "./route-road";
import { lockRouteInputs } from "./route-optimization";
import { uuid } from "./orders-validation";

export type RecalculationJob = {
  planId: string;
  revision: number;
  actor: string;
  token: string;
  attempts: number;
};
export async function claimRecalculation(
  pool: Pool,
): Promise<RecalculationJob | null> {
  const token = randomUUID();
  const { rows } = await pool.query(
    `WITH candidate AS (
    SELECT plan_id FROM route_recalculation_jobs
    WHERE (status='pending' AND available_at<=now()) OR (status='running' AND lease_until<now())
    ORDER BY available_at,plan_id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE route_recalculation_jobs j SET status='running',token=$1,
    lease_until=now()+interval '90 seconds',attempts=attempts+1,updated_at=now()
    FROM candidate c WHERE j.plan_id=c.plan_id RETURNING j.*`,
    [token],
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
    const deleted = await sql.query(
      "DELETE FROM route_recalculation_jobs WHERE plan_id=$1 AND revision=$2 AND token=$3 RETURNING plan_id",
      [job.planId, job.revision, job.token],
    );
    if (!deleted.rowCount) throw new AppError("VERSION_CONFLICT", 409);
    const id = randomUUID();
    const inserted = await sql.query(
      `INSERT INTO route_optimization_runs(id,plan_id,base_plan_version,applied_plan_version,request_hash,input_fingerprint,metrics,routes,skipped,created_by)
      VALUES($1,$2,$3,$3,$4,$4,$5,$6,'[]',$7)
      ON CONFLICT(plan_id,base_plan_version,request_hash) DO NOTHING RETURNING id`,
      [
        id,
        job.planId,
        version,
        fingerprint,
        JSON.stringify(result.metrics),
        JSON.stringify(result.routes),
        job.actor,
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
export async function processRecalculation(pool: Pool, timezone: string) {
  const job = await claimRecalculation(pool);
  if (!job) return false;
  try {
    await assertActiveActor(pool, job.actor);
    const board = await orderBoard(pool, job.planId),
      settings = await getRoutingSettings(pool);
    const fingerprint = routeFingerprint(board, settings.version);
    const result = await calculateManualRoutes(board, settings, timezone, () =>
      renewRecalculation(pool, job),
    );
    await finishRecalculation(
      pool,
      job,
      board.plan.version,
      fingerprint,
      result,
    );
  } catch (error) {
    await failRecalculation(pool, job, error);
  }
  return true;
}
