import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { bootstrap } from "../src/core/auth";
import { migrate } from "../src/core/database";
import {
  configureMobileAccess,
  revokeMobileAccess,
} from "../src/core/driver-mobile-auth";
import { createDriver } from "../src/core/fleet";
import { startPostgres } from "./helpers/postgres";

let db: Awaited<ReturnType<typeof startPostgres>>;
let originalPepper: string | undefined;

describe("driver mobile phone migration", () => {
  beforeAll(async () => {
    originalPepper = process.env.RUTAS_DRIVER_PIN_PEPPER;
    process.env.RUTAS_DRIVER_PIN_PEPPER = randomBytes(48).toString("hex");
    db = await startPostgres();
  });

  afterAll(async () => {
    if (originalPepper === undefined)
      delete process.env.RUTAS_DRIVER_PIN_PEPPER;
    else process.env.RUTAS_DRIVER_PIN_PEPPER = originalPepper;
    await db.close();
  });

  it("blocks canonical collisions, then normalizes legacy Mexican prefixes", async () => {
    const admin = (
      await bootstrap(db.pool, db.config, {
        token: db.config.bootstrapToken,
        name: "Migration QA",
        login: "migration-qa",
        password: randomUUID(),
      })
    ).id;
    const first = await createDriver(db.pool, admin, {
      id: randomUUID(),
      name: "Chofer Uno",
      phone: "3311111111",
      emergency_name: "",
      emergency_phone: "",
      blood_type: "",
      active: true,
    });
    const second = await createDriver(db.pool, admin, {
      id: randomUUID(),
      name: "Chofer Dos",
      phone: "3322222222",
      emergency_name: "",
      emergency_phone: "",
      blood_type: "",
      active: true,
    });
    const disabled = await createDriver(db.pool, admin, {
      id: randomUUID(),
      name: "Chofer Deshabilitado",
      phone: "3333333333",
      emergency_name: "",
      emergency_phone: "",
      blood_type: "",
      active: true,
    });
    await configureMobileAccess(db.pool, admin, first.id, {
      pin: "1234",
      expectedMobileVersion: 0,
    });
    await configureMobileAccess(db.pool, admin, second.id, {
      pin: "5678",
      expectedMobileVersion: 0,
    });
    const disabledAccess = await configureMobileAccess(
      db.pool,
      admin,
      disabled.id,
      { pin: "9012", expectedMobileVersion: 0 },
    );
    await revokeMobileAccess(db.pool, admin, disabled.id, disabledAccess.version);

    await db.pool.query(
      "ALTER TABLE route_driver_mobile_access DROP CONSTRAINT route_driver_mobile_phone_canonical",
    );
    await db.pool.query(
      "UPDATE route_driver_mobile_access SET login_phone=$2 WHERE driver_id=$1",
      [first.id, "523311111111"],
    );
    await db.pool.query(
      "UPDATE route_driver_mobile_access SET login_phone=$2 WHERE driver_id=$1",
      [second.id, "5213311111111"],
    );
    await db.pool.query(
      "UPDATE route_driver_mobile_access SET login_phone=$2 WHERE driver_id=$1",
      [disabled.id, "5213311111111"],
    );
    await db.pool.query(
      "DROP TABLE route_unit_photos,route_plan_publications; UPDATE rutas_installation SET schema_version=10 WHERE singleton=true",
    );

    await expect(migrate(db.pool, db.config.instanceId)).rejects.toMatchObject({
      code: "MOBILE_PHONE_MIGRATION_COLLISION",
    });
    const rolledBack = await db.pool.query(
      "SELECT schema_version FROM rutas_installation WHERE singleton=true",
    );
    expect(rolledBack.rows[0].schema_version).toBe(10);

    await db.pool.query(
      "UPDATE route_driver_mobile_access SET login_phone=$2 WHERE driver_id=$1",
      [second.id, "número inválido"],
    );
    await expect(migrate(db.pool, db.config.instanceId)).rejects.toMatchObject({
      code: "MOBILE_PHONE_MIGRATION_INVALID",
    });
    const invalidRolledBack = await db.pool.query(
      "SELECT schema_version,login_phone FROM rutas_installation CROSS JOIN route_driver_mobile_access WHERE singleton=true AND driver_id=$1",
      [first.id],
    );
    expect(invalidRolledBack.rows[0]).toMatchObject({
      schema_version: 10,
      login_phone: "523311111111",
    });

    await db.pool.query(
      "UPDATE route_driver_mobile_access SET login_phone=$2 WHERE driver_id=$1",
      [second.id, "5213322222222"],
    );
    await migrate(db.pool, db.config.instanceId);

    const migrated = await db.pool.query(
      "SELECT driver_id,login_phone FROM route_driver_mobile_access ORDER BY driver_id",
    );
    expect(
      new Map(migrated.rows.map((row) => [row.driver_id, row.login_phone])),
    ).toEqual(
      new Map([
        [first.id, "3311111111"],
        [second.id, "3322222222"],
        [disabled.id, "3311111111"],
      ]),
    );
    const version = await db.pool.query(
      "SELECT schema_version FROM rutas_installation WHERE singleton=true",
    );
    expect(version.rows[0].schema_version).toBe(23);
    await expect(
      db.pool.query(
        "UPDATE route_driver_mobile_access SET login_phone='523311111111' WHERE driver_id=$1",
        [first.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
