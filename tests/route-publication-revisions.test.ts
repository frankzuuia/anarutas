import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { audit, migrate, transaction } from "../src/core/database";
import { readDriverPlan } from "../src/core/driver-mobile-route";
import { readDriverExecution } from "../src/core/driver-execution-read";
import {
  addPlanVehicles,
  orderBoard,
  removePlanVehicle,
} from "../src/core/orders";
import {
  routeFingerprint,
  vehicleRouteFingerprints,
} from "../src/core/route-fingerprint";
import { migrateRoutePublicationRevisions } from "../src/core/route-publication-revisions-schema";
import { nextPublicationRevision } from "../src/core/route-publication-revisions";
import {
  cancelPublishedRoute,
  publishRoutes,
} from "../src/core/route-publications";
import { startDriverRoute } from "../src/core/route-start";
import { executionFixture } from "./helpers/driver-execution";

type Fixture = Awaited<ReturnType<typeof executionFixture>>;

// Real isolated PG. Persisted calculation data exercises publication, not Google routing.
async function readdVehicle(f: Fixture) {
  const member = f.members[0];
  let board = await orderBoard(f.db.pool, f.planId);
  const shipments = board.shipments
    .filter((s) => s.vehicle_id === member.vehicleId)
    .map((s) => s.id);
  await removePlanVehicle(f.db.pool, f.actor, f.planId, {
    vehicleId: member.vehicleId,
    expectedVersion: board.plan.version,
  });
  expect(
    (
      await f.db.pool.query(
        "SELECT * FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2",
        [f.planId, member.vehicleId],
      )
    ).rows,
  ).toEqual([]);
  board = await orderBoard(f.db.pool, f.planId);
  await addPlanVehicles(f.db.pool, f.actor, f.planId, {
    vehicleIds: [member.vehicleId],
    expectedVersion: board.plan.version,
  });
  await f.db.pool.query(
    "UPDATE route_shipments SET vehicle_id=$2 WHERE id=ANY($1::uuid[])",
    [shipments, member.vehicleId],
  );
  board = await orderBoard(f.db.pool, f.planId);
  const metrics = {
    travelDistanceMeters: 1000,
    travelDurationSeconds: 600,
    waitDurationSeconds: 0,
    totalDurationSeconds: 600,
    performedShipmentCount: shipments.length,
  };
  const routes = board.vehicles.map((vehicle) => ({
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    encodedPolyline: null,
    segmentPolylines: [],
    departureAt: `${board.plan.service_date}T13:00:00.000Z`,
    finishedAt: `${board.plan.service_date}T13:10:00.000Z`,
    trafficMode: "static",
    metrics,
    stops: board.shipments
      .filter((s) => s.vehicle_id === vehicle.id)
      .map((s, index) => ({
        shipmentId: s.id,
        position: index + 1,
        eta: `${board.plan.service_date}T13:10:00.000Z`,
        travelDistanceMeters: 1000,
        travelDurationSeconds: 600,
        waitDurationSeconds: 0,
      })),
  }));
  await f.db.pool.query(
    `INSERT INTO route_optimization_runs(id,plan_id,base_plan_version,applied_plan_version,request_hash,input_fingerprint,metrics,routes,skipped,created_by,vehicle_input_hashes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'[]',$9,$10)`,
    [
      randomUUID(),
      f.planId,
      board.plan.version - 1,
      board.plan.version,
      createHash("sha256").update(randomUUID()).digest("hex"),
      routeFingerprint(board, 0),
      JSON.stringify(metrics),
      JSON.stringify(routes),
      f.actor,
      JSON.stringify(vehicleRouteFingerprints(board, 0)),
    ],
  );
  return {
    scope: "vehicle",
    vehicleId: member.vehicleId,
    expectedVersion: board.plan.version,
  };
}

async function retained(
  f: Fixture,
  vehicleId = f.members[0].vehicleId,
  planId = f.planId,
) {
  return (
    await f.db.pool.query(
      "SELECT last_revision FROM route_publication_revisions WHERE plan_id=$1 AND vehicle_id=$2",
      [planId, vehicleId],
    )
  ).rows[0]?.last_revision;
}

it("readding a cancelled started route creates a new execution without old corrections, preserving history and start guards", async () => {
  const f = await executionFixture();
  try {
    const [member, other] = f.members;
    await f.start();
    const old = await readDriverExecution(
      f.db.pool,
      member.driverId,
      f.planId,
      f.timezone,
    );
    await f.db.pool.query(
      "UPDATE route_driver_execution_stops SET corrected_at=$2 WHERE id=$1",
      [old.stops[0].id, f.now],
    );
    const history = (
      await f.db.pool.query("SELECT * FROM route_driver_executions ORDER BY id")
    ).rows;
    const stops = (
      await f.db.pool.query(
        "SELECT * FROM route_driver_execution_stops ORDER BY id",
      )
    ).rows;
    const board = await orderBoard(f.db.pool, f.planId);
    await cancelPublishedRoute(f.db.pool, f.actor, f.planId, member.vehicleId, {
      expectedVersion: board.plan.version,
      expectedRevision: 1,
    });
    expect(await retained(f)).toBe(2);
    const input = await readdVehicle(f);
    const published = await publishRoutes(f.db.pool, f.actor, f.planId, input);
    expect(published.changes).toEqual([
      { vehicleId: member.vehicleId, revision: 3, action: "published" },
    ]);
    const plan = await readDriverPlan(
      f.db.pool,
      member.driverId,
      f.planId,
      f.timezone,
    );
    expect(plan.routeStatus).toBe("current");
    expect(plan.publication.startedAt).toBeNull();
    const start = (revision: number, driverId = member.driverId, now = f.now) =>
      startDriverRoute(
        f.db.pool,
        driverId,
        f.planId,
        revision,
        f.timezone,
        now,
        f.photoRoot,
      );
    await expect(start(1)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(start(3, other.driverId)).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    await expect(
      start(3, member.driverId, new Date("2026-09-25T17:00:00Z")),
    ).rejects.toMatchObject({ code: "ROUTE_DATE_MISMATCH" });
    await expect(start(3)).rejects.toMatchObject({
      code: "UNIT_PHOTOS_REQUIRED",
    });
    await f.start(member, 3);
    const fresh = await readDriverExecution(
      f.db.pool,
      member.driverId,
      f.planId,
      f.timezone,
    );
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.publicationRevision).toBe(3);
    expect(fresh.hasCorrections).toBe(false);
    expect(await start(3)).toMatchObject({ alreadyStarted: true });
    expect(
      (
        await f.db.pool.query(
          "SELECT * FROM route_driver_executions WHERE id=$1",
          [old.id],
        )
      ).rows,
    ).toEqual(history);
    expect(
      (
        await f.db.pool.query(
          "SELECT * FROM route_driver_execution_stops WHERE execution_id=$1 ORDER BY id",
          [old.id],
        )
      ).rows,
    ).toEqual(stops);
    expect(await retained(f, other.vehicleId)).toBe(1);
  } finally {
    await f.close();
  }
}, 120_000);

it("retains unstarted revisions across repeated removals, serializes concurrent publication and rolls back atomically", async () => {
  const f = await executionFixture();
  try {
    const member = f.members[0];
    for (const revision of [2, 3]) {
      const input = await readdVehicle(f);
      const results = await Promise.all([
        publishRoutes(f.db.pool, f.actor, f.planId, input),
        publishRoutes(f.db.pool, f.actor, f.planId, input),
      ]);
      expect(results.flatMap((result) => result.changes)).toEqual([
        { vehicleId: member.vehicleId, revision, action: "published" },
      ]);
      expect(
        (await publishRoutes(f.db.pool, f.actor, f.planId, input)).changes,
      ).toEqual([]);
      expect(await retained(f)).toBe(revision);
    }
    await f.db.pool.query("DELETE FROM route_publication_revisions");
    await migrateRoutePublicationRevisions(f.db.pool);
    expect(await retained(f, f.members[1].vehicleId)).toBe(1); // Publication without execution/audit.
    expect(await retained(f)).toBe(3);
    const before = (
      await f.db.pool.query(
        "SELECT * FROM route_plan_publications ORDER BY vehicle_id",
      )
    ).rows;
    await expect(
      transaction(f.db.pool, async (sql) => {
        await sql.query(
          "UPDATE route_plan_publications SET revision=revision+1 WHERE plan_id=$1 AND vehicle_id=$2",
          [f.planId, member.vehicleId],
        );
        expect(
          await nextPublicationRevision(sql, f.planId, member.vehicleId, 0),
        ).toBe(5);
        throw new Error("ROLLBACK_TEST");
      }),
    ).rejects.toThrow("ROLLBACK_TEST");
    expect(
      (
        await f.db.pool.query(
          "SELECT * FROM route_plan_publications ORDER BY vehicle_id",
        )
      ).rows,
    ).toEqual(before);
    expect(await retained(f)).toBe(3);
    // Exercise the monotonic floor even for legacy maintenance with a smaller value.
    await f.db.pool.query(
      "UPDATE route_plan_publications SET revision=1 WHERE plan_id=$1 AND vehicle_id=$2",
      [f.planId, member.vehicleId],
    );
    expect(await retained(f)).toBe(3);
    await f.db.pool.query(
      "DELETE FROM route_publication_revisions WHERE plan_id=$1 AND vehicle_id=$2",
      [f.planId, member.vehicleId],
    );
    await f.db.pool.query(
      "UPDATE route_plan_publications SET revision=3 WHERE plan_id=$1 AND vehicle_id=$2",
      [f.planId, member.vehicleId],
    );
    await f.db.pool.query(
      "DELETE FROM route_publication_revisions WHERE plan_id=$1 AND vehicle_id=$2",
      [f.planId, member.vehicleId],
    );
    await f.db.pool.query(
      "DELETE FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2",
      [f.planId, member.vehicleId],
    );
    expect(await retained(f)).toBe(3); // DELETE trigger independently retains OLD.
    expect(
      await nextPublicationRevision(
        f.db.pool,
        randomUUID(),
        member.vehicleId,
        0,
      ),
    ).toBe(1);
    expect(
      await nextPublicationRevision(f.db.pool, f.planId, randomUUID(), 0),
    ).toBe(1);
    expect(
      await nextPublicationRevision(f.db.pool, f.planId, member.vehicleId, 8),
    ).toBe(9);
  } finally {
    await f.close();
  }
}, 120_000);

it("upgrades schema 30 from publications, execution history and both audit shapes without changing active routes", async () => {
  const f = await executionFixture();
  try {
    const [member, other] = f.members;
    await f.start();
    await f.start(other);
    const board = await orderBoard(f.db.pool, f.planId);
    await cancelPublishedRoute(f.db.pool, f.actor, f.planId, member.vehicleId, {
      expectedVersion: board.plan.version,
      expectedRevision: 1,
    });
    await removePlanVehicle(f.db.pool, f.actor, f.planId, {
      vehicleId: member.vehicleId,
      expectedVersion: board.plan.version,
    });
    // Reconstruct a real v30 installation: no revision ledger existed then.
    await f.db.pool.query(
      "DROP TRIGGER retain_route_publication_revision ON route_plan_publications; DROP FUNCTION retain_route_publication_revision(); DROP TABLE route_publication_revisions; UPDATE rutas_installation SET schema_version=30",
    );
    await f.db.pool.query(
      "DELETE FROM route_audit WHERE action='route.start.cancelled' AND entity_id=$1",
      [f.planId],
    );
    const auditVehicles = [randomUUID(), randomUUID(), randomUUID()];
    await audit(f.db.pool, f.actor, "route.publication.changed", f.planId, {
      changes: [
        { vehicleId: auditVehicles[0], revision: 7 },
        { vehicleId: auditVehicles[0], revision: 3 },
      ],
    });
    await audit(f.db.pool, f.actor, "route.start.cancelled", f.planId, {
      vehicleId: auditVehicles[1],
      revision: 4,
    });
    await audit(f.db.pool, f.actor, "route.publication.cancelled", f.planId, {
      vehicleId: auditVehicles[2],
      revision: 6,
    });
    // Unrelated audit details must never be interpreted as publication history.
    await audit(f.db.pool, f.actor, "qa.unrelated", "not-a-plan-id", {
      changes: "unrelated",
    });
    const before = async () =>
      Promise.all(
        [
          "route_plan_publications",
          "route_driver_executions",
          "route_driver_execution_stops",
          "route_unit_photos",
        ].map(
          async (table) =>
            (await f.db.pool.query(`SELECT * FROM ${table} ORDER BY 1,2`)).rows,
        ),
      );
    const snapshots = await before();
    await migrate(f.db.pool, f.db.config.instanceId);
    expect(
      (await f.db.pool.query("SELECT schema_version FROM rutas_installation"))
        .rows[0].schema_version,
    ).toBe(45);
    expect(await retained(f)).toBe(1); // Execution exists even after publication deletion.
    expect(await retained(f, other.vehicleId)).toBe(1); // Active publication preserved.
    expect(
      await Promise.all(auditVehicles.map((id) => retained(f, id))),
    ).toEqual([7, 4, 6]);
    expect(await before()).toEqual(snapshots);
    await f.db.pool.query(
      "UPDATE route_publication_revisions SET last_revision=9 WHERE plan_id=$1 AND vehicle_id=$2",
      [f.planId, auditVehicles[0]],
    );
    await migrateRoutePublicationRevisions(f.db.pool);
    await migrate(f.db.pool, f.db.config.instanceId);
    expect(await retained(f, auditVehicles[0])).toBe(9);
    expect(await before()).toEqual(snapshots);
  } finally {
    await f.close();
  }
}, 120_000);
