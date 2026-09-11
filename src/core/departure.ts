import type { Pool } from "pg";
import { assertActiveActor, audit, transaction } from "./database";
import { AppError } from "./errors";
import { integer, uuid } from "./orders-validation";
import type { Plan } from "./plans";

export function departureMinute(value: unknown): number {
  if (typeof value !== "string" || value.length !== 5 || value[2] !== ":")
    throw new AppError("ROUTING_DEPARTURE_INVALID");
  const digits = value.slice(0, 2) + value.slice(3);
  if (![...digits].every((digit) => "0123456789".includes(digit)))
    throw new AppError("ROUTING_DEPARTURE_INVALID");
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(3));
  if (hour > 23 || minute > 59) throw new AppError("ROUTING_DEPARTURE_INVALID");
  return hour * 60 + minute;
}

export async function saveDeparture(
  pool: Pool,
  actor: string,
  planId: string,
  input: Record<string, unknown>,
): Promise<Plan> {
  const id = uuid(planId);
  const minute = departureMinute(input.departureTime);
  const version = integer(input.expectedVersion, 1);
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    const { rows } = await sql.query(
      "SELECT version,departure_minute FROM route_plans WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!rows[0]) throw new AppError("NOT_FOUND", 404);
    if (Number(rows[0].version) !== version)
      throw new AppError("VERSION_CONFLICT", 409);
    const result = await sql.query(
      `UPDATE route_plans SET departure_minute=$2,
         version=version+CASE WHEN departure_minute IS DISTINCT FROM $2 THEN 1 ELSE 0 END,
         updated_by=$3,updated_at=now() WHERE id=$1
       RETURNING id,service_date::text,label,version,updated_at,departure_minute`,
      [id, minute, actor],
    );
    if (rows[0].departure_minute !== minute)
      await audit(sql, actor, "plan.departure.updated", id, {
        departureMinute: minute,
        version: result.rows[0].version,
      });
    return result.rows[0];
  });
}
