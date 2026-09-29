import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { migrate } from "../src/core/database";
import { listCustomers } from "../src/core/customers";
import { orderBoard } from "../src/core/orders";

it("converts legacy weekdays into auditable daily clock intervals under concurrent migration", async () => {
  const fixture = await executionFixture();
  try {
    const customer = (
      await listCustomers(fixture.db.pool, { archived: false })
    ).customers.find((item) => item.odooPartnerId === 1)!;
    await fixture.db.pool.query(`ALTER TABLE route_customer_windows
      DROP CONSTRAINT route_customer_windows_clock_unique`);
    await fixture.db.pool.query(`ALTER TABLE route_customer_windows
      ADD COLUMN days_mask smallint NOT NULL DEFAULT 127`);
    await fixture.db.pool.query(
      `DELETE FROM route_customer_windows WHERE customer_id=$1`,
      [customer.id],
    );
    const legacy = [
      { days: 1, start: 540, end: 720 },
      { days: 2, start: 600, end: 660 },
      { days: 4, start: 780, end: 840 },
      { days: 8, start: 780, end: 840 },
      { days: 16, start: 900, end: 960 },
      { days: 32, start: 960, end: 1020 },
    ];
    for (const [index, window] of legacy.entries())
      await fixture.db.pool.query(
        `INSERT INTO route_customer_windows
        (id,customer_id,position,days_mask,start_minute,end_minute)
        VALUES($1,$2,$3,$4,$5,$6)`,
        [
          randomUUID(),
          customer.id,
          index + 1,
          window.days,
          window.start,
          window.end,
        ],
      );
    await fixture.db.pool.query(
      "UPDATE rutas_installation SET schema_version=25 WHERE singleton=true",
    );
    await Promise.all([
      migrate(fixture.db.pool, fixture.db.config.instanceId),
      migrate(fixture.db.pool, fixture.db.config.instanceId),
    ]);
    expect(
      (
        await fixture.db.pool.query(
          "SELECT schema_version FROM rutas_installation",
        )
      ).rows[0].schema_version,
    ).toBe(30);
    const windows = (
      await listCustomers(fixture.db.pool, { archived: false })
    ).customers.find((item) => item.id === customer.id)!.windows;
    expect(
      windows.map(({ startMinute, endMinute, position }) => ({
        startMinute,
        endMinute,
        position,
      })),
    ).toEqual([
      { startMinute: 540, endMinute: 720, position: 1 },
      { startMinute: 780, endMinute: 840, position: 2 },
      { startMinute: 900, endMinute: 1020, position: 3 },
    ]);
    const archived = await fixture.db.pool.query(
      `SELECT days_mask,start_minute,end_minute
      FROM route_customer_windows_legacy WHERE customer_id=$1 ORDER BY position`,
      [customer.id],
    );
    expect(archived.rows).toEqual(
      legacy.map((item) => ({
        days_mask: item.days,
        start_minute: item.start,
        end_minute: item.end,
      })),
    );
    expect(
      (
        await fixture.db.pool
          .query(`SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name='route_customer_windows' AND column_name='days_mask'`)
      ).rows[0].n,
    ).toBe(0);
    const shipment = (
      await orderBoard(fixture.db.pool, fixture.planId)
    ).shipments.find((item) => item.partnerId === 1)!;
    expect(shipment.deliveryWindows).toEqual([
      { startMinute: 540, endMinute: 720 },
      { startMinute: 780, endMinute: 840 },
      { startMinute: 900, endMinute: 1020 },
    ]);
    await fixture.db.pool.query(
      "UPDATE route_plans SET service_date=$2 WHERE id=$1",
      [fixture.planId, "2026-09-27"],
    );
    const sundayShipment = (
      await orderBoard(fixture.db.pool, fixture.planId)
    ).shipments.find((item) => item.partnerId === 1)!;
    expect(sundayShipment.deliveryWindows).toEqual(shipment.deliveryWindows);
    const otherCustomer = (
      await listCustomers(fixture.db.pool, { archived: false })
    ).customers.find((item) => item.odooPartnerId === 2)!;
    expect(otherCustomer.windows).toMatchObject([
      { startMinute: 480, endMinute: 600, position: 1 },
    ]);
    await fixture.db.pool.query(
      "UPDATE rutas_installation SET schema_version=25 WHERE singleton=true",
    );
    await migrate(fixture.db.pool, fixture.db.config.instanceId);
    expect(
      (
        await fixture.db.pool.query(
          "SELECT schema_version FROM rutas_installation",
        )
      ).rows[0].schema_version,
    ).toBe(30);
    await fixture.db.pool.query(
      "ALTER TABLE route_customer_windows DROP CONSTRAINT route_customer_windows_clock_unique",
    );
    await fixture.db.pool.query(
      "UPDATE rutas_installation SET schema_version=25 WHERE singleton=true",
    );
    await expect(
      migrate(fixture.db.pool, fixture.db.config.instanceId),
    ).rejects.toThrow("SCHEMA_VERSION_UNSUPPORTED");
    expect(
      (
        await fixture.db.pool.query(
          "SELECT schema_version FROM rutas_installation",
        )
      ).rows[0].schema_version,
    ).toBe(25);
    expect(
      (
        await fixture.db.pool.query(
          `SELECT count(*)::int AS n FROM route_customer_windows_legacy
      WHERE customer_id=$1`,
          [customer.id],
        )
      ).rows[0].n,
    ).toBe(6);
    await fixture.db.pool.query(
      "ALTER TABLE route_customer_windows ADD CONSTRAINT route_customer_windows_clock_unique UNIQUE(customer_id,start_minute,end_minute)",
    );
    await fixture.db.pool.query(
      "UPDATE rutas_installation SET schema_version=26 WHERE singleton=true",
    );
    await migrate(fixture.db.pool, fixture.db.config.instanceId);
  } finally {
    await fixture.close();
  }
}, 120000);
