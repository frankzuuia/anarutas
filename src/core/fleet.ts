import type { Pool } from "pg";
import { assertActiveActor, audit, transaction, type Sql } from "./database";
import { AppError } from "./errors";
import { versionMatches } from "./policy";
import { field, vehicleInput, driverInput } from "./fleet-validation";
import type { Driver, Vehicle } from "./fleet-contract";

const vehicleColumns =
  "v.id,v.name,v.brand,v.model,v.plate,v.mileage::text,v.fuel,v.available,v.driver_id,v.version,d.name AS driver_name";
const driverColumns =
  "d.id,d.name,d.phone,d.emergency_name,d.emergency_phone,d.blood_type,d.active,d.version,ARRAY(SELECT kind FROM route_driver_documents WHERE driver_id=d.id ORDER BY kind) AS documents";

export async function listVehicles(sql: Sql): Promise<Vehicle[]> {
  return (
    await sql.query(
      `SELECT ${vehicleColumns} FROM route_vehicles v LEFT JOIN route_drivers d ON d.id=v.driver_id ORDER BY v.name,v.id`,
    )
  ).rows;
}
export async function listDrivers(sql: Sql): Promise<Driver[]> {
  return (
    await sql.query(
      `SELECT ${driverColumns} FROM route_drivers d ORDER BY d.name,d.id`,
    )
  ).rows;
}
export async function getVehicle(sql: Sql, id: string): Promise<Vehicle> {
  const { rows } = await sql.query(
    `SELECT ${vehicleColumns} FROM route_vehicles v LEFT JOIN route_drivers d ON d.id=v.driver_id WHERE v.id=$1`,
    [id],
  );
  if (!rows.length) throw new AppError("FLEET_NOT_FOUND", 404);
  return rows[0];
}
export async function getDriver(sql: Sql, id: string): Promise<Driver> {
  const { rows } = await sql.query(
    `SELECT ${driverColumns} FROM route_drivers d WHERE d.id=$1`,
    [id],
  );
  if (!rows.length) throw new AppError("FLEET_NOT_FOUND", 404);
  return rows[0];
}
export async function fleetLock(sql: Sql, actor: string) {
  await assertActiveActor(sql, actor);
  await sql.query("SELECT pg_advisory_xact_lock(hashtext('ana-rutas:fleet'))");
}
export function checkFleetVersion(expected: unknown, actual: number) {
  if (typeof expected !== "number" || !versionMatches(expected, actual))
    throw new AppError("FLEET_CONFLICT", 409);
}
function checkCreation(
  existing: Record<string, unknown>,
  input: Record<string, unknown>,
) {
  if (!Object.keys(input).every((key) => existing[key] === input[key]))
    throw new AppError("FLEET_CONFLICT", 409);
}
export async function createVehicle(
  pool: Pool,
  actor: string,
  input: Record<string, unknown>,
) {
  const id = field(input.id, 36, 36);
  const data = vehicleInput(input);
  return transaction(pool, async (sql) => {
    await fleetLock(sql, actor);
    const old = await sql.query(
      "SELECT creation_payload FROM route_vehicles WHERE id=$1",
      [id],
    );
    if (old.rowCount) {
      checkCreation(old.rows[0].creation_payload, data);
      return getVehicle(sql, id);
    }
    const duplicate = await sql.query(
      "SELECT id FROM route_vehicles WHERE plate=$1",
      [data.plate],
    );
    if (duplicate.rowCount) throw new AppError("PLATE_EXISTS", 409);
    await sql.query(
      "INSERT INTO route_vehicles(id,name,brand,model,plate,mileage,fuel,available,creation_payload,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)",
      [
        id,
        data.name,
        data.brand,
        data.model,
        data.plate,
        data.mileage,
        data.fuel,
        data.available,
        JSON.stringify(data),
        actor,
      ],
    );
    await audit(sql, actor, "vehicle.created", id);
    return getVehicle(sql, id);
  });
}
export async function editVehicle(
  pool: Pool,
  actor: string,
  id: string,
  input: Record<string, unknown>,
) {
  const data = vehicleInput(input);
  return transaction(pool, async (sql) => {
    await fleetLock(sql, actor);
    const old = await getVehicle(sql, id);
    checkFleetVersion(input.expectedVersion, old.version);
    if (!data.available && old.driver_id)
      throw new AppError("UNASSIGN_FIRST", 409);
    const duplicate = await sql.query(
      "SELECT id FROM route_vehicles WHERE plate=$1 AND id<>$2",
      [data.plate, id],
    );
    if (duplicate.rowCount) throw new AppError("PLATE_EXISTS", 409);
    await sql.query(
      "UPDATE route_vehicles SET name=$2,brand=$3,model=$4,plate=$5,mileage=$6,fuel=$7,available=$8,version=version+1,updated_by=$9,updated_at=now() WHERE id=$1",
      [
        id,
        data.name,
        data.brand,
        data.model,
        data.plate,
        data.mileage,
        data.fuel,
        data.available,
        actor,
      ],
    );
    await audit(sql, actor, "vehicle.updated", id, {
      version: old.version + 1,
    });
    return getVehicle(sql, id);
  });
}
export async function createDriver(
  pool: Pool,
  actor: string,
  input: Record<string, unknown>,
) {
  const id = field(input.id, 36, 36);
  const data = driverInput(input);
  return transaction(pool, async (sql) => {
    await fleetLock(sql, actor);
    const old = await sql.query(
      "SELECT creation_payload FROM route_drivers WHERE id=$1",
      [id],
    );
    if (old.rowCount) {
      checkCreation(old.rows[0].creation_payload, data);
      return getDriver(sql, id);
    }
    await sql.query(
      "INSERT INTO route_drivers(id,name,phone,emergency_name,emergency_phone,blood_type,active,creation_payload,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)",
      [
        id,
        data.name,
        data.phone,
        data.emergency_name,
        data.emergency_phone,
        data.blood_type,
        data.active,
        JSON.stringify(data),
        actor,
      ],
    );
    await audit(sql, actor, "driver.created", id);
    return getDriver(sql, id);
  });
}
export async function editDriver(
  pool: Pool,
  actor: string,
  id: string,
  input: Record<string, unknown>,
) {
  const data = driverInput(input);
  return transaction(pool, async (sql) => {
    await fleetLock(sql, actor);
    const old = await getDriver(sql, id);
    checkFleetVersion(input.expectedVersion, old.version);
    const assigned = await sql.query(
      "SELECT id FROM route_vehicles WHERE driver_id=$1",
      [id],
    );
    if (!data.active && assigned.rowCount)
      throw new AppError("UNASSIGN_FIRST", 409);
    await sql.query(
      "UPDATE route_drivers SET name=$2,phone=$3,emergency_name=$4,emergency_phone=$5,blood_type=$6,active=$7,version=version+1,updated_by=$8,updated_at=now() WHERE id=$1",
      [
        id,
        data.name,
        data.phone,
        data.emergency_name,
        data.emergency_phone,
        data.blood_type,
        data.active,
        actor,
      ],
    );
    await audit(sql, actor, "driver.updated", id, { version: old.version + 1 });
    return getDriver(sql, id);
  });
}
export async function assignDriver(
  pool: Pool,
  actor: string,
  vehicleId: string,
  input: Record<string, unknown>,
) {
  const driverId =
    input.driver_id === null ? null : field(input.driver_id, 36, 36);
  return transaction(pool, async (sql) => {
    await fleetLock(sql, actor);
    const vehicle = await getVehicle(sql, vehicleId);
    checkFleetVersion(input.expectedVersion, vehicle.version);
    if (driverId) {
      const driver = await getDriver(sql, driverId);
      if (!vehicle.available || !driver.active)
        throw new AppError("FLEET_UNAVAILABLE", 409);
      const assigned = await sql.query(
        "SELECT id FROM route_vehicles WHERE driver_id=$1 AND id<>$2",
        [driverId, vehicleId],
      );
      if (assigned.rowCount) throw new AppError("DRIVER_ASSIGNED", 409);
    }
    if (vehicle.driver_id === driverId) return vehicle;
    await sql.query(
      "UPDATE route_vehicles SET driver_id=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$1",
      [vehicleId, driverId, actor],
    );
    await audit(sql, actor, "vehicle.driver.assigned", vehicleId, {
      previousDriverId: vehicle.driver_id,
      driverId,
      version: vehicle.version + 1,
    });
    return getVehicle(sql, vehicleId);
  });
}
