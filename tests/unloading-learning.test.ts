import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { unloadingLearningFixture } from "./helpers/unloading-learning";
import {
  collectionCapturedAt,
  usableCollectionTime,
} from "../src/core/unloading-learning";
import { maximumUnloadingMinutes } from "../src/core/route-service-time";
import { migrate } from "../src/core/database";
import { getCustomer, updateCustomer } from "../src/core/customers";
import { orderBoard } from "../src/core/orders";
import { buildDirectFleetRequest } from "../src/core/route-google-direct";
import { zoneSettings } from "./helpers/zone-board";
import {
  publishedUnloadingMinutes,
  readLiveRoutes,
} from "../src/core/live-routes";

let f: Awaited<ReturnType<typeof unloadingLearningFixture>>;
let originalVersion: number;
let published: unknown;
const current = () => getCustomer(f.db.pool, f.customerId);
beforeAll(async () => {
  f = await unloadingLearningFixture();
  originalVersion = (await current()).version;
  published = (
    await f.db.pool.query(
      "SELECT snapshot FROM route_plan_publications ORDER BY vehicle_id",
    )
  ).rows;
}, 120000);
afterAll(async () => f?.close());

it("accepts canonical UTC capture only and excludes impossible intervals without throwing", () => {
  for (const value of [
    undefined,
    null,
    30,
    {},
    "",
    "yesterday",
    "2026-10-06",
    "2026-10-06T12:00:00+00:00",
    "x".repeat(41),
  ])
    expect(collectionCapturedAt(value)).toBeNull();
  const arrival = new Date("2026-10-06T15:00:00Z"),
    receipt = new Date("2026-10-06T18:00:00Z");
  expect(collectionCapturedAt("2026-10-06T15:30:00Z")).toBe(
    "2026-10-06T15:30:00.000Z",
  );
  expect(collectionCapturedAt("2026-10-06T15:30:00.123Z")).toBe(
    "2026-10-06T15:30:00.123Z",
  );
  for (const capture of [
    null,
    "invalid",
    "2026-10-06T14:59:59Z",
    arrival.toISOString(),
    "2026-10-06T18:00:00.001Z",
  ])
    expect(usableCollectionTime(capture, arrival, receipt)).toBe(false);
  expect(usableCollectionTime(receipt.toISOString(), arrival, receipt)).toBe(
    true,
  );
  const maximum = new Date(arrival.getTime() + maximumUnloadingMinutes * 60000);
  expect(usableCollectionTime(maximum.toISOString(), arrival, maximum)).toBe(
    true,
  );
  expect(
    usableCollectionTime(
      new Date(+maximum + 1).toISOString(),
      arrival,
      new Date(+maximum + 1),
    ),
  ).toBe(false);
});

it("migrates concurrently and preserves manual customer data and zero historical observations", async () => {
  // Reconstruct the actual pre-feature schema only in this isolated test database.
  await f.db.pool.query(`DROP VIEW route_customer_unloading;
    DROP TABLE route_unloading_visits,route_unloading_observations;
    ALTER TABLE route_customers DROP COLUMN unloading_automatic;
    UPDATE rutas_installation SET schema_version=44`);
  await Promise.all([
    migrate(f.db.pool, f.db.config.instanceId),
    migrate(f.db.pool, f.db.config.instanceId),
  ]);
  expect(
    (await f.db.pool.query("SELECT schema_version FROM rutas_installation"))
      .rows[0].schema_version,
  ).toBe(47);
  expect(await current()).toMatchObject({
    unloadingMinutes: 15,
    unloadingAutomatic: true,
    unloadingEstimate: {
      effectiveMinutes: 15,
      learnedMinutes: null,
      sampleCount: 0,
      lastObservedAt: null,
    },
  });
});

it("counts a grouped visit once, keeps captured time during late/concurrent retries and rejects foreign collection", async () => {
  const first = await f.command(
    0,
    0,
    new Date(+f.now + 15 * 60000).toISOString(),
  );
  await expect(
    f.collect(first, f.members[1].authorization),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await f.collect(first);
  expect((await current()).unloadingEstimate?.sampleCount).toBe(0);
  const last = await f.command(
    0,
    1,
    new Date(+f.now + 30 * 60000).toISOString(),
  );
  const accepted = await Promise.all([
    f.collect(last),
    f.collect(last),
    f.collect(last),
  ]);
  expect(new Set(accepted.map((r) => r.id)).size).toBe(1);
  expect(accepted.filter((r) => !r.duplicate)).toHaveLength(1);
  await expect(
    f.collect({
      ...last,
      attention: {
        ...last.attention,
        capturedAt: new Date(+f.now + 31 * 60000).toISOString(),
      },
    }),
  ).rejects.toMatchObject({ code: "COMMAND_REUSED" });
  const samples = (
    await f.db.pool.query(
      "SELECT extract(epoch FROM completed_at-arrived_at)::int AS seconds FROM route_unloading_visits",
    )
  ).rows;
  expect(samples).toEqual([{ seconds: 1800 }]);
  expect((await current()).unloadingEstimate).toMatchObject({
    effectiveMinutes: 15,
    sampleCount: 1,
  });
});

it("learns on the second visit and passes 30 minutes into real Google request construction", async () => {
  await f.visit(2, 30);
  expect((await current()).unloadingEstimate).toMatchObject({
    effectiveMinutes: 30,
    learnedMinutes: 30,
    sampleCount: 2,
  });
  const board = await orderBoard(f.db.pool, f.planId);
  expect(
    board.shipments
      .filter((s) => s.partnerId === 1)
      .every((s) => s.unloadingMinutes === 30),
  ).toBe(true);
  const built = buildDirectFleetRequest(
    { ...board, plan: { ...board.plan, departure_minute: 480 } },
    zoneSettings,
    f.timezone,
  );
  expect(
    built.request.model.shipments.some((s) =>
      s.deliveries.some((v) => v.duration === "1800s"),
    ),
  ).toBe(true);
  expect((await current()).version).toBe(originalVersion);
  expect(
    (
      await f.db.pool.query(
        "SELECT snapshot FROM route_plan_publications ORDER BY vehicle_id",
      )
    ).rows,
  ).toEqual(published);
  expect(
    (await f.db.pool.query("SELECT * FROM route_recalculation_jobs")).rowCount,
  ).toBe(0);
  const live = await readLiveRoutes(f.db.pool, f.actor);
  expect(live.routes[0].stops[0].unloadingMinutes).toBeNull();
});

it("uses only the latest three, resists a single outlier and updates continuously", async () => {
  await f.visit(4, 40);
  expect((await current()).unloadingEstimate).toMatchObject({
    effectiveMinutes: 30,
    sampleCount: 3,
  });
  await f.visit(6, 40);
  expect((await current()).unloadingEstimate?.effectiveMinutes).toBe(40);
  await f.visit(8, 5);
  expect((await current()).unloadingEstimate?.effectiveMinutes).toBe(40);
});

it("keeps old APK and invalid telemetry collections working without learning them", async () => {
  for (const [index, capture] of [
    [5, undefined],
    [7, "invalid"],
    [9, new Date(Date.now() + 86400000).toISOString()],
  ] as const) {
    await f.arrive(index, new Date(+f.now + index * 60000));
    await f.collect(await f.command(index, 0, capture));
  }
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM route_unloading_visits",
      )
    ).rows[0].n,
  ).toBe(5);
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM route_order_payments",
      )
    ).rows[0].n,
  ).toBe(9);
});

it("averages the first two differing visits, rounds up and isolates other customers", async () => {
  await f.visit(1, 15.1);
  await f.visit(3, 30.1);
  const otherId = (
    await f.db.pool.query(
      "SELECT id FROM route_customers WHERE odoo_partner_id=2",
    )
  ).rows[0].id;
  expect(
    (await getCustomer(f.db.pool, otherId)).unloadingEstimate,
  ).toMatchObject({ effectiveMinutes: 23, sampleCount: 2 });
  expect((await current()).unloadingEstimate?.effectiveMinutes).toBe(40);
});

it("supports versioned manual control, isolation and starts fresh after a location change", async () => {
  const customer = await current();
  const input = {
    displayName: customer.displayName,
    phone: customer.phone,
    deliveryNote: customer.deliveryNote,
    priority: customer.priority,
    fulfillmentMode: customer.fulfillmentMode,
    deliveryAddress: customer.deliveryAddress,
    mapUrl: customer.mapUrl,
    location: {
      latitude: customer.latitude,
      longitude: customer.longitude,
      placeId: customer.placeId,
    },
    windows: customer.windows.map((w) => ({
      start: {
        hour: Math.floor(w.startMinute / 60),
        minute: w.startMinute % 60,
      },
      end: { hour: Math.floor(w.endMinute / 60), minute: w.endMinute % 60 },
    })),
    expectedVersion: customer.version,
    unloadingMinutes: 7,
    unloadingAutomatic: false,
  };
  await expect(
    updateCustomer(f.db.pool, randomUUID(), customer.id, input),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(
    updateCustomer(f.db.pool, f.actor, customer.id, {
      ...input,
      unloadingAutomatic: "false",
    }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  const saved = await updateCustomer(f.db.pool, f.actor, customer.id, input);
  expect(saved.unloadingEstimate?.effectiveMinutes).toBe(7);
  await expect(
    updateCustomer(f.db.pool, f.actor, customer.id, input),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  const automatic = await updateCustomer(f.db.pool, f.actor, customer.id, {
    ...input,
    expectedVersion: saved.version,
    unloadingAutomatic: true,
  });
  expect(automatic.unloadingEstimate?.effectiveMinutes).toBe(40);
  const moved = await updateCustomer(f.db.pool, f.actor, customer.id, {
    ...input,
    unloadingAutomatic: true,
    expectedVersion: automatic.version,
    location: { ...input.location, latitude: 21 },
  });
  expect(moved.unloadingEstimate).toMatchObject({
    effectiveMinutes: 7,
    sampleCount: 0,
  });
  // Still at the old route point: cannot attribute this visit to the new location.
  await f.visit(10, 30);
  expect((await current()).unloadingEstimate?.sampleCount).toBe(0);
  expect(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM route_unloading_visits WHERE customer_id=$1",
        [f.customerId],
      )
    ).rows[0].n,
  ).toBe(5);
});

it("preserves evidence and published service snapshots", async () => {
  await expect(
    f.db.pool.query("UPDATE route_unloading_visits SET completed_at=now()"),
  ).rejects.toBeTruthy();
  await expect(
    f.db.pool.query("DELETE FROM route_unloading_observations"),
  ).rejects.toBeTruthy();
  expect(
    publishedUnloadingMinutes([{ id: "a", unloadingMinutes: 20 }], ["a"], 50),
  ).toBe(20);
  expect(
    publishedUnloadingMinutes([{ id: "a", unloadingMinutes: null }], ["a"], 50),
  ).toBeNull();
  expect(publishedUnloadingMinutes([{ id: "a" }], ["a"], 50)).toBe(50);
  expect(publishedUnloadingMinutes([], ["a"], null)).toBeNull();
});

it("does not combine orders collected on separate visits", async () => {
  const grouped = await unloadingLearningFixture();
  try {
    await grouped.collect(
      await grouped.command(
        0,
        0,
        new Date(+grouped.now + 10 * 60000).toISOString(),
      ),
    );
    await grouped.arrive(1, new Date(+grouped.now + 30 * 60000));
    await grouped.arrive(0, new Date(+grouped.now + 60 * 60000));
    await grouped.collect(
      await grouped.command(
        0,
        1,
        new Date(+grouped.now + 90 * 60000).toISOString(),
      ),
    );
    expect(
      (await getCustomer(grouped.db.pool, grouped.customerId)).unloadingEstimate
        ?.sampleCount,
    ).toBe(0);
    expect(
      (
        await grouped.db.pool.query(
          "SELECT count(*)::int AS n FROM route_order_payments",
        )
      ).rows[0].n,
    ).toBe(2);
  } finally {
    await grouped.close();
  }
}, 60000);
