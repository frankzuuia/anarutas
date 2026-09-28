import type { Sql } from "./database";
import { AppError } from "./errors";

/** Preserve the old calendar and union its clock intervals without narrowing availability. */
export async function migrateCustomerWindowsDaily(sql: Sql) {
  const column = await sql.query(`SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='route_customer_windows' AND column_name='days_mask'`);
  if (!column.rowCount) {
    const daily = await sql.query(`SELECT 1 FROM pg_constraint constraint_row
      JOIN pg_class relation ON relation.oid=constraint_row.conrelid
      JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname=current_schema()
        AND relation.relname='route_customer_windows'
        AND constraint_row.conname='route_customer_windows_clock_unique'
        AND constraint_row.contype='u'`);
    if (!daily.rowCount) throw new AppError("SCHEMA_VERSION_UNSUPPORTED", 503);
  } else {
    await sql.query(`
      CREATE TABLE IF NOT EXISTS route_customer_windows_legacy (
        window_id uuid PRIMARY KEY, customer_id uuid NOT NULL,
        days_mask smallint NOT NULL, start_minute smallint NOT NULL,
        end_minute smallint NOT NULL, position smallint NOT NULL,
        archived_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO route_customer_windows_legacy(window_id,customer_id,days_mask,start_minute,end_minute,position)
      SELECT id,customer_id,days_mask,start_minute,end_minute,position FROM route_customer_windows
      ON CONFLICT(window_id) DO NOTHING;
      CREATE TEMP TABLE daily_customer_windows ON COMMIT DROP AS
      WITH ordered AS (
        SELECT customer_id,start_minute,end_minute,
          max(end_minute) OVER (PARTITION BY customer_id ORDER BY start_minute,end_minute
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_end
        FROM route_customer_windows
      ), islands AS (
        SELECT customer_id,start_minute,end_minute,
          sum(CASE WHEN start_minute > coalesce(previous_end,-1) THEN 1 ELSE 0 END)
            OVER (PARTITION BY customer_id ORDER BY start_minute,end_minute
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS island
        FROM ordered
      ), merged AS (
        SELECT customer_id,min(start_minute) AS start_minute,max(end_minute) AS end_minute
        FROM islands GROUP BY customer_id,island
      )
      SELECT customer_id,start_minute,end_minute,
        row_number() OVER (PARTITION BY customer_id ORDER BY start_minute,end_minute)::smallint AS position
      FROM merged;
      DELETE FROM route_customer_windows;
      ALTER TABLE route_customer_windows DROP COLUMN days_mask;
      INSERT INTO route_customer_windows(id,customer_id,start_minute,end_minute,position)
      SELECT gen_random_uuid(),customer_id,start_minute,end_minute,position
      FROM daily_customer_windows;
      ALTER TABLE route_customer_windows
        ADD CONSTRAINT route_customer_windows_clock_unique UNIQUE(customer_id,start_minute,end_minute);
    `);
  }
  await sql.query(
    "UPDATE rutas_installation SET schema_version=26 WHERE singleton=true",
  );
}
