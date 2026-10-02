import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createUser } from "../src/core/auth";
import { publicationValidationFixture } from "./helpers/publication-validation";
import { publishRoutes } from "../src/core/route-publications";
import { orderBoard } from "../src/core/orders";
import {
  lockDraftSourcePlans,
  refreshDraftSourceShipments,
} from "../src/core/draft-source-sync";

it("blocks panel activation atomically per truck, preserves replay and serializes worker/publication in real PostgreSQL", async () => {
  const f = await publicationValidationFixture();
  try {
    const [a, b] = f.members;
    let board = await f.storeCalculation();
    const own = board.shipments.filter((s) => s.vehicle_id === a.vehicleId);
    const foreign = board.shipments.find((s) => s.vehicle_id === b.vehicleId)!;
    const unassigned = board.shipments.find((s) => !s.vehicle_id)!;
    const publish = (
      vehicleId?: string,
      version = board.plan.version,
      actor = f.actor,
    ) =>
      publishRoutes(f.db.pool, actor, f.planId, {
        scope: vehicleId ? "vehicle" : "all",
        ...(vehicleId ? { vehicleId } : {}),
        expectedVersion: version,
      });
    const state = async () => ({
      publications: (
        await f.db.pool.query(
          "SELECT * FROM route_plan_publications ORDER BY vehicle_id",
        )
      ).rows,
      history: (
        await f.db.pool.query(
          "SELECT * FROM route_publication_revisions ORDER BY vehicle_id",
        )
      ).rows,
      audit: (
        await f.db.pool.query(
          "SELECT * FROM route_audit WHERE action='route.publication.changed' ORDER BY id",
        )
      ).rows,
      push: (
        await f.db.pool.query(
          "SELECT * FROM route_mobile_push_deliveries ORDER BY id",
        )
      ).rows,
      membership: (
        await f.db.pool.query(
          "SELECT * FROM route_plan_vehicles ORDER BY vehicle_id",
        )
      ).rows,
    });
    const unchanged = await state();
    for (const s of [own[1], own[2], foreign, unassigned])
      await f.setStatus(s.id, "pending_validation");
    const pending = own
      .slice(1)
      .map((s) => ({ id: s.id, orderName: s.orderName }));
    for (const vehicleId of [a.vehicleId, b.vehicleId]) {
      await expect(publish(vehicleId)).rejects.toMatchObject({
        code: "ROUTE_ORDERS_NOT_VALIDATED",
        status: 409,
        details: {
          pendingValidationVehicles: expect.arrayContaining([
            {
              vehicleId,
              vehicleName: vehicleId === a.vehicleId ? "Unidad 0" : "Unidad 1",
              pendingValidationOrders:
                vehicleId === a.vehicleId
                  ? pending
                  : [{ id: foreign.id, orderName: foreign.orderName }],
            },
          ]),
        },
      });
      expect(await state()).toEqual(unchanged);
    }
    const allBlocked = await publish();
    expect(allBlocked.changes).toEqual([]);
    expect(allBlocked.skippedValidationVehicles).toHaveLength(2);
    expect(await state()).toEqual(unchanged);
    await f.setStatus(own[1].id, "validated");
    await expect(publish(a.vehicleId)).rejects.toMatchObject({
      code: "ROUTE_ORDERS_NOT_VALIDATED",
      details: { unavailableFolios: [own[2].orderName] },
    });
    for (const status of [null, "unknown"]) {
      await f.setStatus(own[2].id, status);
      await expect(publish(a.vehicleId)).rejects.toMatchObject({
        code: "ROUTE_ORDERS_NOT_VALIDATED",
      });
    }
    await f.setStatus(own[2].id, "cancelled");
    await expect(publish(a.vehicleId)).rejects.toMatchObject({
      code: "ODOO_DELIVERY_UNAVAILABLE",
    });
    await f.setStatus(own[2].id, "validated");
    await f.db.pool.query("UPDATE route_shipments SET snapshot=snapshot-'fulfillmentStatus' WHERE id=$1", [own[2].id]);
    // Other trucks and unassigned orders never block this valid truck.
    const first = await publish();
    expect(first.changes).toEqual([
      { vehicleId: a.vehicleId, revision: 2, action: "published" },
    ]);
    const published = await state();
    expect(first.skippedValidationVehicles).toEqual([
      {
        vehicleId: b.vehicleId,
        vehicleName: "Unidad 1",
        pendingValidationOrders: [
          { id: foreign.id, orderName: foreign.orderName },
        ],
      },
    ]);
    expect((await publish(a.vehicleId)).changes).toEqual([]);
    expect(await state()).toEqual(published);
    const repeatedAll = await publish();
    expect(repeatedAll.changes).toEqual([]);
    expect(repeatedAll.skippedValidationVehicles).toEqual(
      first.skippedValidationVehicles,
    );
    expect(await state()).toEqual(published);
    await expect(publish(randomUUID())).rejects.toMatchObject({
      code: "PLAN_VEHICLE_NOT_FOUND",
      status: 404,
    });
    await expect(
      publish(a.vehicleId, board.plan.version + 1),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      publish(a.vehicleId, board.plan.version, randomUUID()),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    const settlement = await createUser(f.db.pool, f.actor, {
      name: "Liquidador QA",
      login: randomUUID(),
      password: randomUUID(),
      role: "settlement",
    });
    await expect(
      publish(a.vehicleId, board.plan.version, settlement.id),
    ).rejects.toMatchObject({
      code: "ROLE_DENIED",
      status: 403,
    });
    expect(await state()).toEqual(published);

    // A started lane remains immutable and is skipped by bulk publication.
    await f.start(a, 2);
    const started = await state();
    await expect(
      f.setStatus(own[0].id, "pending_validation"),
    ).rejects.toMatchObject({
      code: "PZR01",
      message: "ROUTE_ALREADY_STARTED",
    });
    await expect(publish(a.vehicleId)).rejects.toMatchObject({
      code: "ROUTE_ALREADY_STARTED",
    });
    const snapshot = await f.workerObservation(foreign.id);
    const worker = await f.db.pool.connect();
    let competing = Promise.resolve<
      PromiseSettledResult<Awaited<ReturnType<typeof publish>>>[]
    >([]);
    try {
      await worker.query("BEGIN");
      const plans = await lockDraftSourcePlans(worker, [snapshot]);
      expect(await refreshDraftSourceShipments(worker, [snapshot], plans)).toBe(
        1,
      );
      competing = Promise.allSettled([publish(b.vehicleId)]);
      const pid = (await worker.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        await worker.query("SELECT pg_stat_clear_snapshot()");
        blocked = Boolean(
          (
            await worker.query(
              "SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))",
              [pid],
            )
          ).rowCount,
        );
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      expect(
        (
          await worker.query(
            "SELECT 1 FROM route_plan_publications WHERE vehicle_id=$1",
            [b.vehicleId],
          )
        ).rowCount,
      ).toBe(0);
      await worker.query("COMMIT");
      expect(await competing).toMatchObject([
        { status: "rejected", reason: { code: "VERSION_CONFLICT" } },
      ]);
    } finally {
      await worker.query("ROLLBACK");
      await competing;
      worker.release();
    }
    board = await f.storeCalculation();
    const concurrent = await Promise.all([
      publish(b.vehicleId),
      publish(b.vehicleId),
    ]);
    expect(concurrent.map((result) => result.changes.length).sort()).toEqual([
      0, 1,
    ]);
    expect((await publish()).changes).toEqual([]);
    expect(
      (await state()).publications.find(
        (row) => row.vehicle_id === a.vehicleId,
      ),
    ).toEqual(
      started.publications.find((row) => row.vehicle_id === a.vehicleId),
    );
    expect((await state()).audit).toHaveLength(2);
    const after = await orderBoard(f.db.pool, f.planId);
    expect(
      after.shipments.map((s) => ({
        id: s.id,
        vehicle: s.vehicle_id,
        position: s.position,
      })),
    ).toEqual(
      board.shipments.map((s) => ({
        id: s.id,
        vehicle: s.vehicle_id,
        position: s.position,
      })),
    );
    expect(
      after.shipments.find((s) => s.id === unassigned.id)?.fulfillmentStatus,
    ).toBe("pending_validation");
  } finally {
    await f.close();
  }
});
