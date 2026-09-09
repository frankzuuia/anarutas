import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { assertActiveActor, audit, transaction } from "./database";
import { AppError } from "./errors";
import { textField } from "./auth";
import { versionMatches } from "./policy";

export type Plan = {
  id: string;
  service_date: string;
  label: string;
  version: number;
  updated_at: string;
};
export function serviceDate(value: unknown) {
  const text = textField(value, 10, 10);
  const date = new Date(`${text}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  )
    throw new AppError("INVALID_DATE");
  return text;
}
export async function listPlans(pool: Pool): Promise<Plan[]> {
  const { rows } = await pool.query(
    "SELECT id,service_date::text,label,version,updated_at FROM route_plans ORDER BY service_date DESC LIMIT 100",
  );
  return rows;
}
export async function createPlan(
  pool: Pool,
  actor: string,
  input: Record<string, unknown>,
): Promise<Plan> {
  const date = serviceDate(input.date);
  const label = textField(input.label);
  return transaction(pool, async (client) => {
    await assertActiveActor(client, actor);
    const result = await client.query(
      `INSERT INTO route_plans(id,service_date,label,created_by,updated_by) VALUES($1,$2,$3,$4,$4)
      ON CONFLICT(service_date) DO NOTHING RETURNING id,service_date::text,label,version,updated_at`,
      [randomUUID(), date, label, actor],
    );
    if (result.rowCount) {
      await audit(client, actor, "plan.created", result.rows[0].id, { date });
      return result.rows[0];
    }
    const existing = await client.query(
      "SELECT id,service_date::text,label,version,updated_at FROM route_plans WHERE service_date=$1",
      [date],
    );
    return existing.rows[0];
  });
}
export async function editPlan(
  pool: Pool,
  actor: string,
  id: string,
  input: Record<string, unknown>,
): Promise<Plan> {
  const label = textField(input.label);
  return transaction(pool, async (client) => {
    await assertActiveActor(client, actor);
    const { rows } = await client.query(
      "SELECT version FROM route_plans WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!rows.length) throw new AppError("NOT_FOUND", 404);
    if (
      typeof input.expectedVersion !== "number" ||
      !versionMatches(input.expectedVersion, rows[0].version)
    )
      throw new AppError("VERSION_CONFLICT", 409);
    const result = await client.query(
      "UPDATE route_plans SET label=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$1 RETURNING id,service_date::text,label,version,updated_at",
      [id, label, actor],
    );
    await audit(client, actor, "plan.updated", id, {
      version: result.rows[0].version,
    });
    return result.rows[0];
  });
}
