import type { Pool } from "pg";
import { transaction } from "./database";
import { AppError } from "./errors";
import { todayInTimezone } from "./local-date";
import { integer, uuid } from "./orders-validation";
import { unitPhotoRoot } from "./unit-photos";

export async function startDriverRoute(
  pool: Pool,
  driverId: string,
  planId: string,
  expectedRevision: number,
  timezone: string,
  now = new Date(),
  configuredRoot?: string,
) {
  const id = uuid(planId);
  const revision = integer(expectedRevision, 1);
  return transaction(pool, async (sql) => {
    // Serialize against fleet reassignment/unavailability before checking ownership.
    await sql.query("SELECT pg_advisory_xact_lock(hashtext('ana-rutas:fleet'))");
    const plan = await sql.query(
      "SELECT service_date::text FROM route_plans WHERE id=$1 FOR SHARE",
      [id],
    );
    if (!plan.rowCount) throw new AppError("NOT_FOUND", 404);
    const publication = await sql.query(
      `SELECT pub.vehicle_id,pub.started_at,pub.revision
         FROM route_plan_publications pub
         JOIN route_plan_vehicles pv ON pv.plan_id=pub.plan_id AND pv.vehicle_id=pub.vehicle_id
         JOIN route_vehicles v ON v.id=pub.vehicle_id
         JOIN route_drivers d ON d.id=pub.driver_id
        WHERE pub.plan_id=$1 AND d.active AND (
          (pub.started_at IS NOT NULL AND pub.started_driver_id=$2 AND pv.driver_id=$2)
          OR (pub.started_at IS NULL AND pub.driver_id=$2 AND pv.driver_id=$2
              AND v.driver_id=$2 AND v.available)
        )
        FOR UPDATE OF pub`,
      [id, driverId],
    );
    const route = publication.rows[0];
    if (!route) throw new AppError("NOT_FOUND", 404);
    if (route.revision !== revision) throw new AppError("VERSION_CONFLICT", 409);
    if (route.started_at)
      return { startedAt: route.started_at as Date, alreadyStarted: true };
    await unitPhotoRoot(configuredRoot);
    if (plan.rows[0].service_date !== todayInTimezone(timezone, now))
      throw new AppError("ROUTE_DATE_MISMATCH", 409);
    const count = await sql.query(
      `SELECT count(*)::integer AS n FROM route_unit_photos
       WHERE plan_id=$1 AND vehicle_id=$2 AND driver_id=$3
         AND expires_at>$4::timestamptz
         AND (created_at AT TIME ZONE $5)::date=$6::date`,
      [id, route.vehicle_id, driverId, now.toISOString(), timezone, plan.rows[0].service_date],
    );
    if (Number(count.rows[0].n) < 5)
      throw new AppError("UNIT_PHOTOS_REQUIRED", 409);
    const saved = await sql.query(
      `UPDATE route_plan_publications
       SET started_at=$3::timestamptz,started_driver_id=$2
       WHERE plan_id=$1 AND vehicle_id=$4 AND started_at IS NULL
       RETURNING started_at`,
      [id, driverId, now.toISOString(), route.vehicle_id],
    );
    if (!saved.rowCount) throw new AppError("ROUTE_ALREADY_STARTED", 409);
    await sql.query(
      `INSERT INTO route_driver_mobile_audit(driver_id,action,details)
       VALUES($1,'mobile.route.started',$2::jsonb)`,
      [driverId, JSON.stringify({ planId: id, vehicleId: route.vehicle_id })],
    );
    return { startedAt: saved.rows[0].started_at as Date, alreadyStarted: false };
  });
}
