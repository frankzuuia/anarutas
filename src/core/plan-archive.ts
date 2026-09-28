import type { Pool } from "pg";
import { audit, transaction } from "./database";
import { todayInTimezone } from "./local-date";

export function weeklyPlanCutoff(timezone: string, now = new Date()) {
  const localDay = new Date(`${todayInTimezone(timezone, now)}T00:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  const day = localDay.getUTCDay();
  // First day to keep after the last completed Sunday 20:00 local cutoff.
  const daysBack = day === 0 && hour < 20 ? 7 : day;
  localDay.setUTCDate(localDay.getUTCDate() - daysBack + 1);
  return localDay.toISOString().slice(0, 10);
}
export async function archiveWeeklyPlans(pool: Pool, timezone: string, now = new Date()) {
  const cutoff = weeklyPlanCutoff(timezone, now);
  return transaction(pool, async sql => {
    await sql.query("SELECT pg_advisory_xact_lock(hashtext('ana-rutas:plan-archive'))");
    // Visibility only. No deletion, publication revocation or execution changes.
    const { rows } = await sql.query(`UPDATE route_plans SET archived_at=$2
      WHERE archived_at IS NULL AND service_date<$1::date RETURNING id,service_date::text`, [cutoff, now]);
    for (const row of rows) await audit(sql, null, "plan.archived.weekly", row.id,
      { cutoff, timezone, serviceDate: row.service_date });
    return { archived: rows.length, cutoff };
  });
}
