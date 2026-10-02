import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { paymentExecutionFixture } from "./helpers/payment-execution";
import { prepareSameDayPlan } from "./helpers/same-day-plan";
import { createUser } from "../src/core/auth";
import {
  readDriverDashboard,
  readDriverPlan,
} from "../src/core/driver-mobile-route";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { driverPublicationFingerprint } from "../src/core/driver-mobile-events";
import { confirmOrderPayment } from "../src/core/payments";
import {
  readMobileFinanceDetail,
  readSettlementDetail,
} from "../src/core/finance-read";
import { requestSettlement, decideSettlement } from "../src/core/settlements";
import { completeDriverWork } from "../src/core/route-work";
import { assertRouteResourcesFree } from "../src/core/route-start-resources";
import { cancelPublishedRoute } from "../src/core/route-publications";
import { orderBoard } from "../src/core/orders";
import { readLiveRoutes } from "../src/core/live-routes";
import { assignDriver } from "../src/core/fleet";

it("finishes and settles the first route then starts another the same day without mixing history", async () => {
  const f = await paymentExecutionFixture({ warehouseRequired: false });
  try {
    const auth = f.members[0].authorization;
    const finance = () =>
      readMobileFinanceDetail(f.db.pool, auth, f.executionId);
    const dashboard = () =>
      readDriverDashboard(f.db.pool, f.members[0].driverId, f.timezone, f.now);
    const before = (
      await f.db.pool.query(
        "SELECT snapshot FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2",
        [f.planId, f.members[0].vehicleId],
      )
    ).rows[0].snapshot;
    const oldFingerprint = await driverPublicationFingerprint(
      f.db.pool,
      f.members[0].driverId,
    );
    const next = await prepareSameDayPlan(f);
    await next.photos();
    expect(
      await driverPublicationFingerprint(f.db.pool, f.members[0].driverId),
    ).not.toBe(oldFingerprint);
    expect((await dashboard()).today?.plan.id).toBe(f.planId);
    await expect(next.start()).rejects.toMatchObject({
      code: "DRIVER_ROUTE_IN_PROGRESS",
      status: 409,
    });
    for (const order of (await finance()).orders)
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
    // GPS completion alone must not replace a route waiting for financial close.
    await f.finish();
    expect((await dashboard()).today?.plan.id).toBe(f.planId);
    await expect(next.start()).rejects.toMatchObject({
      code: "DRIVER_ROUTE_IN_PROGRESS",
    });
    const receiver = (
      await createUser(f.db.pool, f.actor, {
        name: "Recepción",
        login: "same-day-receiver",
        password: randomUUID(),
        role: "settlement",
      })
    ).id;
    const requested = await requestSettlement(f.db.pool, auth, f.executionId, {
      commandId: randomUUID(),
      shipmentId: null,
      basis: (await finance()).routeSettlement.basis,
    });
    const packet = (await finance()).requests.find(
      (r) => r.id === requested.id,
    )!;
    await decideSettlement(f.db.pool, receiver, packet.id, {
      commandId: randomUUID(),
      version: packet.version,
      basis: packet.basis,
      decision: "accepted",
      note: "",
    });
    const finished = await completeDriverWork(f.db.pool, auth, f.executionId, {
      commandId: randomUUID(),
      basis: (await finance()).work.basis,
    });
    const receipts = (await finance()).orders.map((o) => o.payment);
    expect((await dashboard()).today?.plan.id).toBe(next.planId);
    expect((await next.start()).alreadyStarted).toBe(false);
    expect((await next.start()).alreadyStarted).toBe(true);
    const another = await readDriverExecution(
      f.db.pool,
      f.members[0].driverId,
      next.planId,
      f.timezone,
    );
    expect(another.id).not.toBe(f.executionId);
    expect(another.stops).toHaveLength(1);
    expect(another.stops[0].shipmentIds).toEqual([next.board.shipments[0].id]);
    expect(
      (await readMobileFinanceDetail(f.db.pool, auth, another.id)).orders.every(
        (o) => !o.payment,
      ),
    ).toBe(true);
    const historic = await readDriverPlan(
      f.db.pool,
      f.members[0].driverId,
      f.planId,
      f.timezone,
    );
    expect(
      (
        await f.db.pool.query(
          "SELECT snapshot FROM route_plan_publications WHERE plan_id=$1 AND vehicle_id=$2",
          [f.planId, f.members[0].vehicleId],
        )
      ).rows[0].snapshot,
    ).toEqual(before);
    expect(historic.orders.map((o: { id: string }) => o.id)).toEqual(
      f.shipmentRows.map((s: { id: string }) => s.id),
    );
    expect(historic.publication.workCompletedAt).toBe(finished.completedAt);
    expect((await finance()).orders.map((o) => o.payment)).toEqual(receipts);
    expect(
      (await readSettlementDetail(f.db.pool, receiver, f.executionId)).work
        .completion?.summary,
    ).toEqual(finished.summary);
    const live = await readLiveRoutes(f.db.pool, f.actor);
    expect(live.routes.some((r) => r.id === f.executionId)).toBe(false);
    expect(live.routes.some((r) => r.id === another.id)).toBe(true);
  } finally {
    await f.close();
  }
}, 60000);

it("serializes two simultaneous starts and keeps the winner as the active dashboard route", async () => {
  const f = await executionFixture();
  try {
    const one = await prepareSameDayPlan(f);
    const two = await prepareSameDayPlan(f);
    await one.photos();
    await two.photos();
    const results = await Promise.allSettled([one.start(), two.start()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "DRIVER_ROUTE_IN_PROGRESS" });
    const winner = results[0].status === "fulfilled" ? one : two;
    expect(
      (
        await readDriverDashboard(
          f.db.pool,
          f.members[0].driverId,
          f.timezone,
          f.now,
        )
      ).today?.plan.id,
    ).toBe(winner.planId);
    expect(
      (
        await f.db.pool.query(
          "SELECT 1 FROM route_driver_executions WHERE driver_id=$1",
          [f.members[0].driverId],
        )
      ).rowCount,
    ).toBe(1);
    await expect(
      assertRouteResourcesFree(
        f.db.pool,
        f.members[0].driverId,
        f.members[1].vehicleId,
      ),
    ).rejects.toMatchObject({ code: "DRIVER_ROUTE_IN_PROGRESS" });
    await expect(
      assertRouteResourcesFree(
        f.db.pool,
        f.members[1].driverId,
        f.members[0].vehicleId,
      ),
    ).rejects.toMatchObject({ code: "DRIVER_ROUTE_IN_PROGRESS" });
    await assertRouteResourcesFree(
      f.db.pool,
      f.members[1].driverId,
      f.members[1].vehicleId,
    );
  } finally {
    await f.close();
  }
}, 60000);

it("does not free an occupied vehicle when fleet ownership changes to another driver", async () => {
  const f = await executionFixture();
  try {
    await f.start();
    const priorUnit = (
      await f.db.pool.query("SELECT version FROM route_vehicles WHERE id=$1", [
        f.members[1].vehicleId,
      ])
    ).rows[0];
    await assignDriver(f.db.pool, f.actor, f.members[1].vehicleId, {
      driver_id: null,
      expectedVersion: priorUnit.version,
    });
    const vehicle = (
      await f.db.pool.query("SELECT version FROM route_vehicles WHERE id=$1", [
        f.members[0].vehicleId,
      ])
    ).rows[0];
    await assignDriver(f.db.pool, f.actor, f.members[0].vehicleId, {
      driver_id: f.members[1].driverId,
      expectedVersion: vehicle.version,
    });
    const next = await prepareSameDayPlan(f, {
      member: { ...f.members[1], vehicleId: f.members[0].vehicleId },
    });
    await next.photos();
    await expect(next.start()).rejects.toMatchObject({
      code: "DRIVER_ROUTE_IN_PROGRESS",
    });
    expect(
      (
        await f.db.pool.query(
          "SELECT started_at FROM route_plan_publications WHERE plan_id=$1",
          [next.planId],
        )
      ).rows[0].started_at,
    ).toBeNull();
  } finally {
    await f.close();
  }
}, 60000);

it("allows another published route after legitimate cancellation without reusing its photos or execution", async () => {
  const f = await executionFixture();
  try {
    await f.start();
    const original = await readDriverExecution(
      f.db.pool,
      f.members[0].driverId,
      f.planId,
      f.timezone,
    );
    const next = await prepareSameDayPlan(f);
    expect(
      (
        await readDriverPlan(
          f.db.pool,
          f.members[0].driverId,
          next.planId,
          f.timezone,
        )
      ).publication.photoCount,
    ).toBe(0);
    const board = await orderBoard(f.db.pool, f.planId);
    await cancelPublishedRoute(
      f.db.pool,
      f.actor,
      f.planId,
      f.members[0].vehicleId,
      { expectedVersion: board.plan.version, expectedRevision: 1 },
    );
    await expect(next.start()).rejects.toMatchObject({
      code: "UNIT_PHOTOS_REQUIRED",
    });
    await next.photos();
    expect((await next.start()).alreadyStarted).toBe(false);
    expect(
      (
        await readDriverExecution(
          f.db.pool,
          f.members[0].driverId,
          next.planId,
          f.timezone,
        )
      ).id,
    ).not.toBe(original.id);
  } finally {
    await f.close();
  }
}, 60000);
