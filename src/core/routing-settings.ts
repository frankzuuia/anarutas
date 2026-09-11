import type { Pool } from "pg";
import { assertActiveActor, audit, transaction, type Sql } from "./database";
import { AppError } from "./errors";
import { readRoutingDefaults } from "./routing-config";
import type { RoutingSettings } from "./routing-contract";
import { routingSettingsInput } from "./routing-validation";

function mapRow(
  row: Record<string, unknown> | undefined,
): RoutingSettings | null {
  if (!row) return null;
  return {
    depotAddress: String(row.depot_address),
    depotLocation: {
      latitude: Number(row.depot_latitude),
      longitude: Number(row.depot_longitude),
      placeId: row.depot_place_id ? String(row.depot_place_id) : null,
    },
    version: Number(row.version),
    updatedAt: String(row.updated_at),
  };
}

export async function getRoutingSettings(pool: Sql): Promise<RoutingSettings> {
  const { rows } = await pool.query(
    "SELECT * FROM route_routing_settings WHERE singleton=true",
  );
  return (
    mapRow(rows[0]) || {
      depotAddress: readRoutingDefaults().depotAddress,
      depotLocation: null,
      version: 0,
      updatedAt: null,
    }
  );
}

export async function saveRoutingSettings(
  pool: Pool,
  actor: string,
  input: Record<string, unknown>,
): Promise<RoutingSettings> {
  const data = routingSettingsInput(input);
  return transaction(pool, async (sql) => {
    await assertActiveActor(sql, actor);
    // A missing singleton row cannot be protected with FOR UPDATE. The advisory
    // lock serializes the first insert and every later versioned update alike.
    await sql.query(
      "SELECT pg_advisory_xact_lock(hashtext('ana-rutas:routing-settings'))",
    );
    const previous = await sql.query(
      "SELECT version FROM route_routing_settings WHERE singleton=true FOR UPDATE",
    );
    const version = previous.rows[0] ? Number(previous.rows[0].version) : 0;
    if (version !== data.expectedVersion)
      throw new AppError("VERSION_CONFLICT", 409);
    const { rows } = await sql.query(
      `INSERT INTO route_routing_settings(
         singleton,depot_address,depot_latitude,depot_longitude,depot_place_id,version,updated_by
       ) VALUES(true,$1,$2,$3,$4,1,$5)
       ON CONFLICT(singleton) DO UPDATE SET
         depot_address=EXCLUDED.depot_address,
         depot_latitude=EXCLUDED.depot_latitude,
         depot_longitude=EXCLUDED.depot_longitude,
         depot_place_id=EXCLUDED.depot_place_id,
         version=route_routing_settings.version+1,
         updated_by=EXCLUDED.updated_by,
         updated_at=now()
       RETURNING *`,
      [
        data.depotAddress,
        data.depotLocation.latitude,
        data.depotLocation.longitude,
        data.depotLocation.placeId,
        actor,
      ],
    );
    await audit(sql, actor, "routing.settings.updated", "depot", {
      version: rows[0].version,
      locationConfirmed: true,
    });
    return mapRow(rows[0])!;
  });
}
