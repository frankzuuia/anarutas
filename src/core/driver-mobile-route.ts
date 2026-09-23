import type { Pool } from "pg";
import { transaction } from "./database";
import { AppError } from "./errors";
import { uuid } from "./orders-validation";
import { todayInTimezone } from "./local-date";

export async function listDriverPlans(pool: Pool, driverId: string) {
  const { rows } = await pool.query(
    `SELECT p.id,p.service_date::text AS service_date,
            pub.snapshot->'plan'->>'label' AS label,
            pub.source_plan_version AS version,
            pub.revision AS publication_revision,pub.started_at,
            pv.vehicle_id,v.name AS vehicle_name,v.plate,
            jsonb_array_length(pub.snapshot->'orders') AS orders
     FROM route_plan_publications pub
     JOIN route_plan_vehicles pv
       ON pv.plan_id=pub.plan_id AND pv.vehicle_id=pub.vehicle_id
     JOIN route_plans p ON p.id=pub.plan_id
     JOIN route_vehicles v ON v.id=pub.vehicle_id
     JOIN route_drivers d ON d.id=pub.driver_id
     WHERE d.active AND pub.revoked_at IS NULL AND (
       (pub.started_at IS NOT NULL AND pub.started_driver_id=$1 AND pv.driver_id=$1)
       OR (pub.started_at IS NULL AND pub.driver_id=$1 AND pv.driver_id=$1
           AND v.driver_id=$1 AND v.available)
     )
     ORDER BY p.service_date DESC,p.id DESC`,
    [driverId],
  );
  return rows;
}

export async function readDriverDashboard(
  pool: Pool,
  driverId: string,
  timezone: string,
  now = new Date(),
) {
  const serviceDate = todayInTimezone(timezone, now);
  const plans = await listDriverPlans(pool, driverId);
  const today = plans.find((plan) => plan.service_date === serviceDate);
  return {
    serviceDate,
    plans,
    today: today
      ? await readDriverPlan(pool, driverId, today.id, timezone)
      : null,
  };
}

export async function readDriverPlan(
  pool: Pool,
  driverId: string,
  planId: string,
  timezone: string,
) {
  const id = uuid(planId);
  return transaction(pool, async (sql) => {
    // Match the planner's lock order (plan, then vehicle/publication).
    const plan = await sql.query(
      "SELECT id FROM route_plans WHERE id=$1 FOR SHARE",
      [id],
    );
    if (!plan.rowCount) throw new AppError("NOT_FOUND", 404);
    const publication = await sql.query(
      `SELECT pub.snapshot,pub.revision,pub.started_at,
              (SELECT count(*)::integer FROM route_unit_photos photo
                WHERE photo.plan_id=pub.plan_id AND photo.vehicle_id=pub.vehicle_id
                  AND photo.driver_id=pub.driver_id AND photo.expires_at>now()
                  AND (photo.created_at AT TIME ZONE $3)::date=plan.service_date) AS photo_count
       FROM route_plan_publications pub
       JOIN route_plans plan ON plan.id=pub.plan_id
       JOIN route_plan_vehicles pv
         ON pv.plan_id=pub.plan_id AND pv.vehicle_id=pub.vehicle_id
       JOIN route_vehicles v ON v.id=pub.vehicle_id
       JOIN route_drivers d ON d.id=pub.driver_id
       WHERE pub.plan_id=$1 AND d.active AND pub.revoked_at IS NULL AND (
         (pub.started_at IS NOT NULL AND pub.started_driver_id=$2 AND pv.driver_id=$2)
         OR (pub.started_at IS NULL AND pub.driver_id=$2 AND pv.driver_id=$2
             AND v.driver_id=$2 AND v.available)
       )
       FOR SHARE OF pub,pv,v,d`,
      [id, driverId, timezone],
    );
    const assigned = publication.rows[0];
    if (!assigned) throw new AppError("NOT_FOUND", 404);
    return {
      ...assigned.snapshot,
      publication: {
        revision: Number(assigned.revision),
        startedAt: assigned.started_at,
        photoCount: Number(assigned.photo_count),
      },
    };
  });
}
