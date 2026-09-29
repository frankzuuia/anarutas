import type { Sql } from "./database";

/** Caller holds the plan's FOR UPDATE lock through publication commit. */
export async function nextPublicationRevision(sql: Sql, planId: string, vehicleId: string, previousRevision: number) {
  const { rows } = await sql.query<{ revision: number }>(
    `SELECT GREATEST(COALESCE((SELECT last_revision FROM route_publication_revisions
       WHERE plan_id=$1 AND vehicle_id=$2),0),$3::integer)+1 AS revision`,
    [planId, vehicleId, previousRevision],
  );
  return Number(rows[0].revision);
}
