import type { Pool } from "pg";
import { AppError } from "./errors";
import type { Sql } from "./database";

export async function bindOdooSource(sql: Sql, fingerprint: string) {
  await sql.query(
    "INSERT INTO route_order_source(singleton,fingerprint) VALUES(true,$1) ON CONFLICT(singleton) DO NOTHING",
    [fingerprint],
  );
  const { rows } = await sql.query(
    "SELECT fingerprint FROM route_order_source WHERE singleton=true FOR SHARE",
  );
  if (rows[0]?.fingerprint !== fingerprint)
    throw new AppError("ODOO_SOURCE_CHANGED", 409);
}

export async function assertBoundOdooSource(pool: Pool, fingerprint: string) {
  const { rows } = await pool.query(
    "SELECT fingerprint FROM route_order_source WHERE singleton=true",
  );
  if (rows.length && rows[0].fingerprint !== fingerprint)
    throw new AppError("ODOO_SOURCE_CHANGED", 409);
}
