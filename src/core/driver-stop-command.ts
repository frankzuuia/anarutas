import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { transaction, type Sql } from "./database";
import { searchKey } from "./customers";
import { authenticateMobile } from "./driver-mobile-auth";
import { executableRoute, type ExecutionRow, type ExecutionStopRow } from "./driver-execution-read";
import { readOperationPolicy } from "./driver-operation-settings";
import { arrivalLateness, correctedDeliveryAddress, geoPoint, gpsSample, lastClosingMinute, validateProximity, type CorrectedDeliveryAddress, type GeoPoint } from "./driver-execution-policy";
import { integer, uuid } from "./orders-validation";
import { todayInTimezone } from "./local-date";
import { AppError } from "./errors";
import { driverCommandReceipt as receipt, saveDriverCommandReceipt as saveReceipt, type DriverCommandResult as CommandResult } from "./driver-command-receipts";
import { caseVisitEvent } from "./driver-service-cases";

export type StopCommandKind = "arrival" | "repoint";

function commandInput(raw: Record<string, unknown>, kind: StopCommandKind) {
  return {
    commandId: uuid(raw.commandId), executionId: uuid(raw.executionId),
    publicationRevision: integer(raw.publicationRevision, 1), executionRevision: integer(raw.executionRevision, 1),
    stopVersion: integer(raw.stopVersion, 1), policyVersion: integer(raw.policyVersion, 1),
    sample: gpsSample(raw.sample),
    point: kind === "repoint" ? geoPoint(raw.point) : null,
    address: kind === "repoint" ? correctedDeliveryAddress(raw.address) : null,
    customerLocationVersion: kind === "repoint" ? integer(raw.customerLocationVersion) : null,
  };
}

function historicalContext(route: ExecutionRow, stop: ExecutionStopRow) {
  return { planId: route.plan_id, vehicleId: route.vehicle_id, planLabel: route.plan_label,
    vehicle: route.vehicle_name, plate: route.vehicle_plate, driver: route.driver_name,
    serviceDate: route.service_date, customerId: stop.customer_id, customer: stop.customer_name,
    address: stop.address, shipmentIds: stop.shipment_ids, orders: stop.order_names, position: stop.position };
}

async function recordVisitExit(sql: Sql, route: ExecutionRow, stop: ExecutionStopRow,
  driverId: string, deviceId: string, now: Date, timezone: string, reason: "destination_changed" | "new_arrival") {
  const eventId = randomUUID();
  await caseVisitEvent(sql, route.id, stop.id, driverId, "retry_abandoned", stop.visit_sequence, now);
  await sql.query(
    "UPDATE route_driver_execution_stops SET visit_state='open',arrived_at=NULL,version=version+1 WHERE id=$1",
    [stop.id],
  );
  await sql.query(
    `INSERT INTO route_driver_stop_events(id,execution_id,stop_id,driver_id,device_id,kind,
       occurred_at,event_date,timezone,details,visit_sequence)
     VALUES($1,$2,$3,$4,$5,'visit_exit',$6,$7,$8,$9,$10)`,
    [eventId, route.id, stop.id, driverId, deviceId, now,
      todayInTimezone(timezone, now), timezone,
      JSON.stringify({ ...historicalContext(route, stop), reason }), stop.visit_sequence],
  );
  await sql.query(
    "INSERT INTO route_driver_mobile_audit(driver_id,action,details) VALUES($1,$2,$3)",
    [driverId, "mobile.stop.visit_exited", JSON.stringify({ executionId: route.id, stopId: stop.id,
      eventId, visitSequence: stop.visit_sequence, planId: route.plan_id, deviceId, reason })],
  );
  return eventId;
}

async function correctCustomer(sql: Sql, route: ExecutionRow, stop: ExecutionStopRow,
  point: GeoPoint, address: CorrectedDeliveryAddress | null, expectedLocationVersion: number, now: Date, commandId: string) {
  const { rows } = await sql.query("SELECT * FROM route_customers WHERE id=$1 FOR UPDATE", [stop.customer_id]);
  const customer = rows[0];
  if (!customer || customer.archived_at) throw new AppError("CUSTOMER_UNAVAILABLE", 409);
  if (customer.location_version !== expectedLocationVersion) throw new AppError("CUSTOMER_LOCATION_CONFLICT", 409);
  const before = { latitude: customer.latitude as number | null, longitude: customer.longitude as number | null };
  const beforeAddress = String(customer.delivery_address);
  const newAddress = address?.formatted ?? beforeAddress;
  if (point.latitude === stop.latitude && point.longitude === stop.longitude &&
      point.latitude === customer.latitude && point.longitude === customer.longitude &&
      newAddress === beforeAddress && newAddress === stop.address) return { unchanged: true, before, beforeAddress, address: newAddress };
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`;
  const updatedSearch = searchKey([customer.display_name, customer.odoo_name, customer.phone,
    customer.odoo_phone, customer.odoo_mobile, newAddress, customer.odoo_address,
    customer.odoo_ref, customer.odoo_partner_id, customer.delivery_note,
    customer.parent_name, customer.commercial_name]);
  await sql.query(
    `UPDATE route_customers SET latitude=$2,longitude=$3,place_id=NULL,map_url=$4,
       location_status='driver_confirmed',location_version=location_version+1,version=version+1,
       updated_by=NULL,updated_by_driver=$5,updated_at=$6,
       delivery_address=$7,address_overridden=address_overridden OR $8::boolean,
       search_key=$9 WHERE id=$1`,
    [stop.customer_id, point.latitude, point.longitude, mapUrl, route.driver_id, now,
      newAddress, address !== null, updatedSearch],
  );
  await sql.query(
    `INSERT INTO route_customer_location_history(id,customer_id,location_version,address,latitude,
       longitude,map_url,source,driver_id,shipment_id,idempotency_key,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,'driver',$8,$9,$10,$11)`,
    [randomUUID(), stop.customer_id, customer.location_version + 1, newAddress,
      point.latitude, point.longitude, mapUrl, route.driver_id, stop.shipment_ids[0],
      `${route.id}:${commandId}`, now],
  );
  await sql.query(
    `UPDATE route_driver_execution_stops SET latitude=$3,longitude=$4,address=$6,corrected_at=$5,version=version+1
      WHERE execution_id=$1 AND customer_id=$2`, [route.id, stop.customer_id, point.latitude, point.longitude, now, newAddress],
  );
  return { unchanged: false, before, beforeAddress, address: newAddress };
}

export async function executeStopCommand(pool: Pool, authorization: string | null, planId: string,
  stopId: string, kind: StopCommandKind, raw: Record<string, unknown>, timezone: string, at?: Date) {
  const input = commandInput(raw, kind);
  const plan = uuid(planId), stopKey = uuid(stopId);
  const hash = createHash("sha256").update(JSON.stringify({ plan, stopKey, kind, input })).digest("hex");
  return transaction(pool, async (sql) => {
    const driver = await authenticateMobile(sql, authorization, true);
    // Serializes reused keys even if a modified client sends them to different plans.
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`driver-command:${driver.device_id}:${input.commandId}`]);
    const route = await executableRoute(sql, driver.driver_id, plan, true);
    if (route.id !== input.executionId || route.publication_revision !== input.publicationRevision)
      throw new AppError("VERSION_CONFLICT", 409);
    const previous = await receipt(sql, driver.device_id, input.commandId, hash);
    if (previous) return previous;
    const { rows } = await sql.query<ExecutionStopRow>("SELECT * FROM route_driver_execution_stops WHERE id=$1 AND execution_id=$2 FOR UPDATE", [stopKey, route.id]);
    const stop = rows[0];
    if (!stop) throw new AppError("NOT_FOUND", 404);
    const remember = (result: CommandResult) => saveReceipt(sql, driver.device_id, input.commandId, hash, route.id, result);
    if (kind === "arrival" && stop.visit_state === "arrived") {
      const arrived = await sql.query("SELECT id,occurred_at FROM route_driver_stop_events WHERE execution_id=$1 AND stop_id=$2 AND visit_sequence=$3 AND kind='arrival'", [route.id, stop.id, stop.visit_sequence]);
      return remember({ eventId: arrived.rows[0].id, occurredAt: arrived.rows[0].occurred_at.toISOString(), executionRevision: route.revision, duplicate: true });
    }
    if (route.revision !== input.executionRevision || stop.version !== input.stopVersion)
      throw new AppError("VERSION_CONFLICT", 409);
    const policy = await readOperationPolicy(sql, true);
    if (policy.version !== input.policyVersion) throw new AppError("OPERATION_POLICY_CHANGED", 409);
    const point = input.point ?? geoPoint(stop);
    const now = at ?? new Date();
    const distance = validateProximity(input.sample, point, policy, now);
    let lateSeconds: number | null = null;
    let customerBefore: { latitude: number | null; longitude: number | null } | null = null;
    let previousAddress: string | null = null;
    let correctedAddress: string | null = null;
    let correctedAddressFields: Omit<CorrectedDeliveryAddress, "formatted"> | null = null;
    if (kind === "arrival") {
      const activeElsewhere = await sql.query<ExecutionStopRow>(
        `SELECT * FROM route_driver_execution_stops
          WHERE execution_id=$1 AND id<>$2 AND visit_state='arrived'
          ORDER BY position FOR UPDATE`, [route.id, stop.id],
      );
      for (const prior of activeElsewhere.rows)
        await recordVisitExit(sql, route, prior, driver.driver_id, driver.device_id, now, timezone, "new_arrival");
      const closing = lastClosingMinute(stop.windows);
      const close = closing === null ? null : (await sql.query(
        "SELECT (($1::date + make_interval(mins => $2)) AT TIME ZONE $3) AS close",
        [route.service_date, closing, timezone],
      )).rows[0].close as Date | null;
      lateSeconds = arrivalLateness(now, close);
      await sql.query("UPDATE route_driver_execution_stops SET arrived_at=$2,visit_state='arrived',visit_sequence=visit_sequence+1,version=version+1 WHERE id=$1", [stop.id, now]);
      await caseVisitEvent(sql, route.id, stop.id, driver.driver_id, "retry_arrived", stop.visit_sequence + 1, now);
    } else {
      const corrected = await correctCustomer(sql, route, stop, point, input.address, input.customerLocationVersion!, now, input.commandId);
      if (corrected.unchanged) return remember({ eventId: null, occurredAt: now.toISOString(), executionRevision: route.revision, duplicate: false, unchanged: true });
      customerBefore = corrected.before;
      previousAddress = corrected.beforeAddress;
      correctedAddress = corrected.address;
      correctedAddressFields = input.address && { street: input.address.street, neighborhood: input.address.neighborhood,
        postalCode: input.address.postalCode, city: input.address.city };
    }
    const eventId = randomUUID();
    await sql.query(
      `INSERT INTO route_driver_stop_events(id,execution_id,stop_id,driver_id,device_id,kind,
         incident_kind,occurred_at,event_date,timezone,details,visit_sequence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [eventId, route.id, stop.id, driver.driver_id, driver.device_id, kind,
        kind === "repoint" ? "location_corrected" : lateSeconds !== null && lateSeconds > 0 ? "late_arrival" : null,
        now, todayInTimezone(timezone, now), timezone, JSON.stringify({ ...historicalContext(route, stop),
          point, before: { latitude: stop.latitude, longitude: stop.longitude }, customerBefore,
          previousAddress, correctedAddress, correctedAddressFields,
          sample: input.sample, policy, distanceMeters: distance, windows: stop.windows, lateSeconds }),
        kind === "arrival" ? stop.visit_sequence + 1 : stop.visit_sequence || null],
    );
    await sql.query("UPDATE route_driver_executions SET revision=revision+1 WHERE id=$1", [route.id]);
    await sql.query(
      "INSERT INTO route_driver_mobile_audit(driver_id,action,details) VALUES($1,$2,$3)",
      [driver.driver_id, kind === "arrival" ? "mobile.stop.arrived" : "mobile.stop.repointed",
        JSON.stringify({ executionId: route.id, stopId: stop.id, eventId, planId: plan, deviceId: driver.device_id })],
    );
    return remember({ eventId, occurredAt: now.toISOString(), executionRevision: route.revision + 1, duplicate: false });
  });
}

// Ending an unattended visit never changes any order or creates an incident.
// A later arrival must pass the current GPS policy and obtains a new visit number.
export async function exitDriverVisit(pool: Pool, authorization: string | null, planId: string,
  stopId: string, raw: Record<string, unknown>, timezone: string, at?: Date) {
  const input = {
    commandId: uuid(raw.commandId), executionId: uuid(raw.executionId),
    publicationRevision: integer(raw.publicationRevision, 1),
    executionRevision: integer(raw.executionRevision, 1),
    stopVersion: integer(raw.stopVersion, 1), visitSequence: integer(raw.visitSequence, 1),
  };
  const plan = uuid(planId), stopKey = uuid(stopId);
  const hash = createHash("sha256").update(JSON.stringify({ plan, stopKey, kind: "visit_exit", input })).digest("hex");
  return transaction(pool, async (sql) => {
    const driver = await authenticateMobile(sql, authorization, true);
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`driver-command:${driver.device_id}:${input.commandId}`]);
    const route = await executableRoute(sql, driver.driver_id, plan, true);
    if (route.id !== input.executionId || route.publication_revision !== input.publicationRevision)
      throw new AppError("VERSION_CONFLICT", 409);
    const previous = await receipt(sql, driver.device_id, input.commandId, hash);
    if (previous) return previous;
    const { rows } = await sql.query<ExecutionStopRow>(
      "SELECT * FROM route_driver_execution_stops WHERE id=$1 AND execution_id=$2 FOR UPDATE",
      [stopKey, route.id],
    );
    const stop = rows[0];
    if (!stop) throw new AppError("NOT_FOUND", 404);
    if (route.revision !== input.executionRevision || stop.version !== input.stopVersion)
      throw new AppError("VERSION_CONFLICT", 409);
    if (stop.visit_state !== "arrived" || stop.visit_sequence !== input.visitSequence)
      throw new AppError("VISIT_NOT_ACTIVE", 409);
    const now = at ?? new Date();
    const eventId = await recordVisitExit(sql, route, stop, driver.driver_id, driver.device_id,
      now, timezone, "destination_changed");
    await sql.query("UPDATE route_driver_executions SET revision=revision+1 WHERE id=$1", [route.id]);
    return saveReceipt(sql, driver.device_id, input.commandId, hash, route.id, {
      eventId, occurredAt: now.toISOString(), executionRevision: route.revision + 1, duplicate: false,
    });
  });
}
