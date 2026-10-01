import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { paymentExecutionFixture } from "./helpers/payment-execution";
import { createUser } from "../src/core/auth";
import { transaction } from "../src/core/database";
import { confirmOrderPayment } from "../src/core/payments";
import { requestSettlement, decideSettlement } from "../src/core/settlements";
import { completeDriverWork } from "../src/core/route-work";
import {
  readMobileFinanceDetail,
  readSettlementDetail,
} from "../src/core/finance-read";
import {
  readDriverDashboard,
  readDriverPlan,
} from "../src/core/driver-mobile-route";
import { readLiveRoutes } from "../src/core/live-routes";
import { writeLiveTracking } from "../src/core/live-tracking";
import {
  listRoutePublications,
  cancelPublishedRoute,
} from "../src/core/route-publications";
import { startDriverRoute } from "../src/core/route-start";
import { executeStopCommand } from "../src/core/driver-stop-command";
import { retryDriverOrder } from "../src/core/driver-order-retry";

type Fixture = Awaited<ReturnType<typeof paymentExecutionFixture>>;
async function receiveAll(f: Fixture, warehouseRequired = false) {
  const auth = f.members[0].authorization;
  const read = () => readMobileFinanceDetail(f.db.pool, auth, f.executionId);
  for (const shipment of f.shipmentRows) {
    const order = (await read()).orders.find(
      (o) => o.shipmentId === shipment.id,
    )!;
    await confirmOrderPayment(
      f.db.pool,
      auth,
      f.executionId,
      {
        commandId: randomUUID(),
        shipmentId: order.shipmentId,
        basis: order.basis,
        captureVersion: 2,
        method: "cash",
        tendered: "20",
        change: "0",
        note: "",
      },
      f.timezone,
    );
  }
  if (warehouseRequired) await f.finish();
  const detail = await read();
  const receiver = (
    await createUser(f.db.pool, f.actor, {
      name: "Recepción cierre",
      login: "closure-receiver",
      password: randomUUID(),
      role: "settlement",
    })
  ).id;
  const request = await requestSettlement(f.db.pool, auth, f.executionId, {
    commandId: randomUUID(),
    shipmentId: null,
    basis: detail.routeSettlement.basis,
  });
  const packet = (await read()).requests.find((r) => r.id === request.id)!;
  await decideSettlement(f.db.pool, receiver, packet.id, {
    commandId: randomUUID(),
    version: packet.version,
    basis: packet.basis,
    decision: "accepted",
    note: "",
  });
  return { receiver, review: (await read()).work };
}

for (const warehouseRequired of [false, true])
  it(`work closure ends the route across actual readers and guards, warehouse=${warehouseRequired}`, async () => {
    const f = await paymentExecutionFixture({ warehouseRequired });
    try {
      const auth = f.members[0].authorization;
      await f.start(f.members[1]);
      const route = await f.state();
      const tracking = {
        executionId: f.executionId,
        publicationRevision: route.publicationRevision,
        sessionId: randomUUID(),
      };
      await writeLiveTracking(f.db.pool, auth, f.planId, {
        ...tracking,
        kind: "begin",
      });
      await writeLiveTracking(f.db.pool, auth, f.planId, {
        ...tracking,
        kind: "sample",
        sequence: 1,
        targetStopId: route.stops[0].id,
        sample: {
          latitude: 20.64,
          longitude: -103.4,
          accuracyMeters: 5,
          ageMilliseconds: 0,
          mock: false,
        },
        eta: {
          targetStopId: route.stops[0].id,
          state: "ready",
          remainingSeconds: 60,
          ageMilliseconds: 0,
        },
      });
      const { receiver, review } = await receiveAll(f, warehouseRequired);
      expect(
        (await readLiveRoutes(f.db.pool, f.actor)).routes.some(
          (r) => r.id === f.executionId,
        ),
      ).toBe(true);
      const dashboard = () =>
        readDriverDashboard(
          f.db.pool,
          f.members[0].driverId,
          f.timezone,
          f.now,
        );
      expect((await dashboard()).today?.plan.id).toBe(f.planId);
      const revision = (await f.state()).revision;
      const command = { commandId: randomUUID(), basis: review.basis };
      const results = await Promise.all([
        completeDriverWork(f.db.pool, auth, f.executionId, command),
        completeDriverWork(f.db.pool, auth, f.executionId, command),
      ]);
      expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
      expect(results[0].summary).toEqual(review.summary);
      const ended = await f.state();
      expect(ended.completedAt).toBe(results[0].completedAt);
      expect(ended.revision).toBe(revision + 1);
      expect((await dashboard()).today).toBeNull();
      expect(
        (await dashboard()).plans
          .find((p) => p.id === f.planId)
          .work_completed_at.toISOString(),
      ).toBe(results[0].completedAt);
      const plan = await readDriverPlan(
        f.db.pool,
        f.members[0].driverId,
        f.planId,
        f.timezone,
      );
      expect(plan.publication.workCompletedAt).toBe(results[0].completedAt);
      expect(plan.orders).toHaveLength(3);
      const publications = await transaction(f.db.pool, (sql) =>
        listRoutePublications(sql, f.planId),
      );
      expect(
        publications
          .find((p) => p.vehicle_id === f.members[0].vehicleId)
          ?.work_completed_at?.toISOString(),
      ).toBe(results[0].completedAt);
      expect(
        publications.find((p) => p.vehicle_id === f.members[1].vehicleId)
          ?.work_completed_at,
      ).toBeNull();
      const live = await readLiveRoutes(f.db.pool, f.actor);
      expect(live.routes.some((r) => r.id === f.executionId)).toBe(false);
      expect(
        live.routes.some((r) => r.driverId === f.members[1].driverId),
      ).toBe(true);
      expect(
        (
          await readDriverDashboard(
            f.db.pool,
            f.members[1].driverId,
            f.timezone,
            f.now,
          )
        ).today,
      ).not.toBeNull();
      expect(
        (
          await f.db.pool.query(
            "SELECT stopped,target_stop_id,eta,warehouse_depot_version FROM route_live_tracking WHERE execution_id=$1",
            [f.executionId],
          )
        ).rows[0],
      ).toEqual({
        stopped: true,
        target_stop_id: null,
        eta: null,
        warehouse_depot_version: null,
      });
      await expect(
        writeLiveTracking(f.db.pool, auth, f.planId, {
          ...tracking,
          kind: "begin",
        }),
      ).rejects.toMatchObject({ code: "ROUTE_COMPLETED" });
      await expect(
        startDriverRoute(
          f.db.pool,
          f.members[0].driverId,
          f.planId,
          1,
          f.timezone,
          f.now,
          f.photoRoot,
        ),
      ).rejects.toMatchObject({ code: "ROUTE_COMPLETED" });
      const stop = ended.stops[0];
      const identity = {
        commandId: randomUUID(),
        executionId: ended.id,
        publicationRevision: ended.publicationRevision,
        executionRevision: ended.revision,
        stopVersion: stop.version,
        visitSequence: stop.visitSequence,
        policyVersion: ended.policy.version,
      };
      await expect(
        executeStopCommand(
          f.db.pool,
          auth,
          f.planId,
          stop.id,
          "arrival",
          {
            ...identity,
            sample: {
              latitude: 20.64,
              longitude: -103.4,
              accuracyMeters: 5,
              ageMilliseconds: 0,
              capturedAt: f.now.toISOString(),
              mock: false,
            },
          },
          f.timezone,
          f.now,
        ),
      ).rejects.toMatchObject({ code: "ROUTE_COMPLETED" });
      await expect(
        retryDriverOrder(
          f.db.pool,
          auth,
          f.planId,
          stop.id,
          stop.orderStates[0].shipmentId,
          {
            ...identity,
            commandId: randomUUID(),
            orderVersion: stop.orderStates[0].version,
          },
          f.timezone,
          f.now,
        ),
      ).rejects.toMatchObject({ code: "ROUTE_COMPLETED" });
      const version = (
        await f.db.pool.query("SELECT version FROM route_plans WHERE id=$1", [
          f.planId,
        ])
      ).rows[0].version;
      await expect(
        cancelPublishedRoute(
          f.db.pool,
          f.actor,
          f.planId,
          f.members[0].vehicleId,
          { expectedVersion: version, expectedRevision: 1 },
        ),
      ).rejects.toMatchObject({ code: "ROUTE_COMPLETED" });
      expect(
        (await readSettlementDetail(f.db.pool, receiver, f.executionId)).work
          .completion?.summary,
      ).toEqual(review.summary);
      expect(
        (
          await readMobileFinanceDetail(f.db.pool, auth, f.executionId)
        ).orders.every((o) => o.settlementStatus === "accepted"),
      ).toBe(true);
      expect(
        (
          await f.db.pool.query(
            "SELECT count(*)::int n FROM route_driver_execution_completions WHERE execution_id=$1",
            [f.executionId],
          )
        ).rows[0].n,
      ).toBe(warehouseRequired ? 1 : 0);
      expect(
        (await completeDriverWork(f.db.pool, auth, f.executionId, command))
          .duplicate,
      ).toBe(true);
      expect((await f.state()).revision).toBe(revision + 1);
    } finally {
      await f.close();
    }
  }, 120000);

it("recognizes previously stored work completion without rewriting GPS evidence or receipts", async () => {
  const f = await paymentExecutionFixture({ warehouseRequired: false });
  try {
    const { review } = await receiveAll(f);
    const at = new Date("2026-10-01T18:00:00Z");
    await f.db.pool.query(
      `INSERT INTO route_driver_work_completions(execution_id,driver_id,device_id,command_id,request_hash,completed_at,snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        f.executionId,
        f.members[0].driverId,
        f.members[0].deviceId,
        randomUUID(),
        "a".repeat(64),
        at,
        JSON.stringify(review.summary),
      ],
    );
    expect(
      (
        await readDriverDashboard(
          f.db.pool,
          f.members[0].driverId,
          f.timezone,
          f.now,
        )
      ).today,
    ).toBeNull();
    expect(
      (
        await readDriverPlan(
          f.db.pool,
          f.members[0].driverId,
          f.planId,
          f.timezone,
        )
      ).publication.completedAt,
    ).toBe(at.toISOString());
    expect(
      (await readLiveRoutes(f.db.pool, f.actor)).routes.some(
        (r) => r.id === f.executionId,
      ),
    ).toBe(false);
    expect((await f.state()).completedAt).toBe(at.toISOString());
    expect(
      (
        await readMobileFinanceDetail(
          f.db.pool,
          f.members[0].authorization,
          f.executionId,
        )
      ).route.completedAt,
    ).toBeNull();
  } finally {
    await f.close();
  }
}, 120000);
