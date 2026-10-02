import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import {
  routeStartPendingOrders,
  readRouteStartPendingOrders,
} from "../src/core/route-start-validation";
import { readDriverPlan } from "../src/core/driver-mobile-route";
import { startDriverRoute } from "../src/core/route-start";
import { driverPublicationFingerprint } from "../src/core/driver-mobile-events";
import { createPlan } from "../src/core/plans";
import {
  orderBoard,
  persistImportPage,
  selectPlanVehicles,
} from "../src/core/orders";
import {
  lockDraftSourcePlans,
  refreshDraftSourceShipments,
} from "../src/core/draft-source-sync";
import { financialObservation } from "./helpers/financial";
import { buildFinancialSnapshot } from "../src/core/financial-policy";

it("enforces vehicle-scoped validation, worker/start serialization and unchanged replay in real PostgreSQL", async () => {
  const f = await executionFixture();
  try {
    const [member, other] = f.members;
    const before = await orderBoard(f.db.pool, f.planId);
    const own = before.shipments.filter(
      (s) => s.vehicle_id === member.vehicleId,
    );
    const setStatus = (id: string, status: string) =>
      f.db.pool.query(
        "UPDATE route_shipments SET snapshot=jsonb_set(snapshot,'{fulfillmentStatus}',to_jsonb($2::text)) WHERE id=$1",
        [id, status],
      );
    const start = () =>
      startDriverRoute(
        f.db.pool,
        member.driverId,
        f.planId,
        1,
        f.timezone,
        f.now,
        f.photoRoot,
      );
    const frozen = (
      await f.db.pool.query(
        "SELECT snapshot FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2",
        [f.planId, member.vehicleId],
      )
    ).rows[0].snapshot;
    await setStatus(own[1].id, "pending_validation");
    await setStatus(own[2].id, "pending_validation");
    const pending = own
      .slice(1)
      .map((s) => ({ id: s.id, orderName: s.orderName }));
    expect(
      (await readDriverPlan(f.db.pool, member.driverId, f.planId, f.timezone))
        .publication.pendingValidationOrders,
    ).toEqual(pending);
    await expect(f.start(member)).rejects.toMatchObject({
      code: "ROUTE_ORDERS_NOT_VALIDATED",
      status: 409,
      details: { pendingValidationOrders: pending },
    });
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int AS n FROM route_driver_executions",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int AS n FROM route_driver_mobile_audit WHERE action='mobile.route.started'",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.db.pool.query(
          "SELECT started_at FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2",
          [f.planId, member.vehicleId],
        )
      ).rows[0].started_at,
    ).toBeNull();
    await setStatus(own[1].id, "validated");
    await expect(start()).rejects.toMatchObject({
      code: "ROUTE_ORDERS_NOT_VALIDATED",
      details: { pendingValidationOrders: [pending[1]] },
    });
    await expect(
      startDriverRoute(
        f.db.pool,
        other.driverId,
        f.planId,
        2,
        f.timezone,
        f.now,
        f.photoRoot,
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      startDriverRoute(
        f.db.pool,
        member.driverId,
        f.planId,
        2,
        f.timezone,
        f.now,
        f.photoRoot,
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    // Current vehicle and plan scopes; other publications and unassigned orders stay routable.
    const otherOrder = before.shipments.find(
      (s) => s.vehicle_id === other.vehicleId,
    )!;
    await setStatus(otherOrder.id, "pending_validation");
    const sourceRow = (
      await f.db.pool.query(
        "SELECT source,snapshot FROM route_shipments WHERE id=$1",
        [own[0].id],
      )
    ).rows[0];
    const extra = {
      ...sourceRow.snapshot,
      pickingId: 100,
      orderId: 100,
      orderName: "Sin asignar",
      fulfillmentStatus: "pending_validation" as const,
    };
    const page = {
      fingerprint: sourceRow.source,
      shipments: [extra],
      nextCursor: 100,
      ceiling: 100,
      hasMore: false,
      inspected: 1,
      excluded: 0,
    };
    await persistImportPage(f.db.pool, f.actor, f.planId, page);
    const otherPlan = await createPlan(f.db.pool, f.actor, {
      date: before.plan.service_date,
      label: "Otra salida",
    });
    await selectPlanVehicles(f.db.pool, f.actor, otherPlan.id, {
      vehicleIds: [member.vehicleId],
      expectedVersion: otherPlan.version,
    });
    await persistImportPage(f.db.pool, f.actor, otherPlan.id, page);
    await f.db.pool.query(
      "UPDATE route_shipments SET vehicle_id=$2 WHERE plan_id=$1",
      [otherPlan.id, member.vehicleId],
    );
    expect(
      await readRouteStartPendingOrders(
        f.db.pool,
        otherPlan.id,
        member.vehicleId,
      ),
    ).toHaveLength(1);
    expect(
      (await readDriverPlan(f.db.pool, other.driverId, f.planId, f.timezone))
        .publication.pendingValidationOrders,
    ).toEqual([{ id: otherOrder.id, orderName: otherOrder.orderName }]);
    expect(
      (await readDriverPlan(f.db.pool, member.driverId, f.planId, f.timezone))
        .publication.pendingValidationOrders,
    ).toEqual([pending[1]]);
    await setStatus(own[2].id, "unknown");
    await expect(start()).rejects.toMatchObject({
      code: "ROUTE_ORDERS_NOT_VALIDATED",
    });
    await f.db.pool.query(
      "UPDATE route_shipments SET snapshot=jsonb_set(snapshot,'{fulfillmentStatus}','null') WHERE id=$1",
      [own[2].id],
    );
    expect(
      await readRouteStartPendingOrders(f.db.pool, f.planId, member.vehicleId),
    ).toEqual([pending[1]]);
    await expect(start()).rejects.toMatchObject({
      code: "ROUTE_ORDERS_NOT_VALIDATED",
    });
    await setStatus(own[2].id, "pending_validation");
    const fingerprint = await driverPublicationFingerprint(
      f.db.pool,
      member.driverId,
    );
    await setStatus(own[2].id, "validated");
    expect(
      await driverPublicationFingerprint(f.db.pool, member.driverId),
    ).not.toBe(fingerprint);
    await setStatus(own[2].id, "pending_validation");
    expect(await driverPublicationFingerprint(f.db.pool, member.driverId)).toBe(
      fingerprint,
    );

    // Exercise the existing worker domain observation while its real plan lock blocks departure.
    const row = (
      await f.db.pool.query(
        "SELECT source,snapshot FROM route_shipments WHERE id=$1",
        [own[2].id],
      )
    ).rows[0];
    const observation = financialObservation(),
      shipment = row.snapshot;
    observation.picking.id = shipment.pickingId;
    observation.picking.partnerId = shipment.partnerId;
    observation.order.id = shipment.orderId;
    observation.moves[0].id = shipment.lines[0].moveId;
    observation.moves[0].pickingId = shipment.pickingId;
    observation.moves[0].productId = shipment.lines[0].productId;
    observation.saleLines[0].productId = shipment.lines[0].productId;
    observation.relatedPickings = [observation.picking];
    const snapshot = buildFinancialSnapshot(
      {
        source: row.source,
        pickingId: shipment.pickingId,
        orderId: shipment.orderId,
        partnerId: shipment.partnerId,
      },
      observation,
    );
    const worker = await f.db.pool.connect();
    let departures = Promise.resolve<
      PromiseSettledResult<Awaited<ReturnType<typeof start>>>[]
    >([]);
    try {
      await worker.query("BEGIN");
      const plans = await lockDraftSourcePlans(worker, [snapshot]);
      expect(await refreshDraftSourceShipments(worker, [snapshot], plans)).toBe(
        1,
      );
      departures = Promise.allSettled([start(), start()]);
      const workerPid = (await worker.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      // Wait for evidence of the actual lock, not a guessed duration.
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        // pg_stat_activity snapshots are cached inside a transaction.
        await worker.query("SELECT pg_stat_clear_snapshot()");
        const locks = await worker.query(
          "SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))",
          [workerPid],
        );
        blocked = Boolean(locks.rowCount);
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      expect(
        (
          await worker.query(
            "SELECT count(*)::int AS n FROM route_driver_executions",
          )
        ).rows[0].n,
      ).toBe(0);
      await worker.query("COMMIT");
      const results = await departures;
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      expect(
        results
          .flatMap((r) =>
            r.status === "fulfilled" ? [r.value.alreadyStarted] : [],
          )
          .sort(),
      ).toEqual([false, true]);
    } finally {
      await worker.query("ROLLBACK");
      await departures;
      worker.release();
    }
    expect(
      await driverPublicationFingerprint(f.db.pool, member.driverId),
    ).not.toBe(fingerprint);
    expect(
      await readRouteStartPendingOrders(f.db.pool, f.planId, member.vehicleId),
    ).toEqual([]);
    expect(
      routeStartPendingOrders(
        (await orderBoard(f.db.pool, f.planId)).shipments.filter(
          (s) => s.vehicle_id === member.vehicleId,
        ),
      ),
    ).toEqual([]);
    expect(
      (await readDriverPlan(f.db.pool, member.driverId, f.planId, f.timezone))
        .publication.pendingValidationOrders,
    ).toEqual([]);
    expect(
      (
        await f.db.pool.query(
          "SELECT snapshot FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2",
          [f.planId, member.vehicleId],
        )
      ).rows[0].snapshot,
    ).toEqual(frozen);
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int AS n FROM route_driver_executions",
        )
      ).rows[0].n,
    ).toBe(1);
    expect((await start()).alreadyStarted).toBe(true);
    await expect(f.start(other)).rejects.toMatchObject({
      code: "ROUTE_ORDERS_NOT_VALIDATED",
    });
  } finally {
    await f.close();
  }
}, 120_000);
