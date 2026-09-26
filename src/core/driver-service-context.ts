import { createHash } from "node:crypto";
import type { Sql } from "./database";
import { authenticateMobile } from "./driver-mobile-auth";
import { executableRoute, type ExecutionRow, type ExecutionStopRow } from "./driver-execution-read";
import { driverCommandReceipt } from "./driver-command-receipts";
import { integer, uuid } from "./orders-validation";
import { AppError } from "./errors";

export function serviceIdentity(raw: Record<string, unknown>) {
  return {
    commandId: uuid(raw.commandId), executionId: uuid(raw.executionId),
    publicationRevision: integer(raw.publicationRevision, 1), executionRevision: integer(raw.executionRevision, 1),
    stopVersion: integer(raw.stopVersion, 1), visitSequence: integer(raw.visitSequence, 1),
  };
}

export async function lockServiceContext(sql: Sql, authorization: string | null, planId: string,
  stopId: string, input: ReturnType<typeof serviceIdentity>, payload: unknown) {
  const plan = uuid(planId), stopKey = uuid(stopId);
  const hash = createHash("sha256").update(JSON.stringify({ plan, stopKey, input, payload })).digest("hex");
  const driver = await authenticateMobile(sql, authorization, true);
  await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`driver-command:${driver.device_id}:${input.commandId}`]);
  const route = await executableRoute(sql, driver.driver_id, plan, true);
  if (route.id !== input.executionId || route.publication_revision !== input.publicationRevision)
    throw new AppError("VERSION_CONFLICT", 409);
  const previous = await driverCommandReceipt(sql, driver.device_id, input.commandId, hash);
  // Replays precede mutable revision checks: a committed response may have been lost.
  if (previous) return { previous, driver, route, hash, stop: null };
  const { rows } = await sql.query<ExecutionStopRow>(
    "SELECT * FROM route_driver_execution_stops WHERE id=$1 AND execution_id=$2 FOR UPDATE", [stopKey, route.id]);
  const stop = rows[0];
  if (!stop) throw new AppError("NOT_FOUND", 404);
  if (route.revision !== input.executionRevision || stop.version !== input.stopVersion)
    throw new AppError("VERSION_CONFLICT", 409);
  if (stop.visit_state !== "arrived" || stop.visit_sequence !== input.visitSequence)
    throw new AppError("VISIT_NOT_ACTIVE", 409);
  return { previous: null, driver, route, hash, stop };
}

export function serviceSnapshot(route: ExecutionRow, stop: ExecutionStopRow) {
  return { planId: route.plan_id, vehicleId: route.vehicle_id, planLabel: route.plan_label,
    vehicle: route.vehicle_name, plate: route.vehicle_plate, driver: route.driver_name,
    serviceDate: route.service_date, customerId: stop.customer_id, customer: stop.customer_name,
    address: stop.address, shipmentIds: stop.shipment_ids, orders: stop.order_names, position: stop.position };
}
