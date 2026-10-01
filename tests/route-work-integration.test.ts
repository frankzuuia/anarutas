import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { paymentExecutionFixture } from "./helpers/payment-execution";
import { createUser } from "../src/core/auth";
import { migrate, transaction } from "../src/core/database";
import { financialObservation } from "./helpers/financial";
import { buildFinancialSnapshot } from "../src/core/financial-policy";
import { persistFinancialSnapshot } from "../src/core/financial-store";
import {
  readMobileFinanceDetail,
  readSettlementDetail,
} from "../src/core/finance-read";
import { confirmOrderPayment } from "../src/core/payments";
import { requestSettlement, decideSettlement } from "../src/core/settlements";
import { completeDriverWork } from "../src/core/route-work";
import { driverPublicationFingerprint } from "../src/core/driver-mobile-events";

it("closes real warehouse work exactly once only after every receipt is received, preserving reviewed totals, owner and immutable history", async () => {
  const f = await paymentExecutionFixture();
  try {
    const receiver = (
      await createUser(f.db.pool, f.actor, {
        name: "Recepción trabajo",
        login: "work-receiver",
        password: randomUUID(),
        role: "settlement",
      })
    ).id;
    const auth = f.members[0].authorization;
    const read = () => readMobileFinanceDetail(f.db.pool, auth, f.executionId);
    const finish = (
      basis: string,
      commandId = randomUUID(),
      authorization: string | null = auth,
    ) =>
      completeDriverWork(f.db.pool, authorization, f.executionId, {
        commandId,
        basis,
      });
    const sqlFinish = (
      summary: unknown,
      deviceId = f.members[0].deviceId,
      driverId = f.members[0].driverId,
    ) =>
      f.db.pool.query(
        `INSERT INTO route_driver_work_completions(execution_id,driver_id,device_id,command_id,request_hash,completed_at,snapshot)
      VALUES($1,$2,$3,$4,$5,now(),$6)`,
        [
          f.executionId,
          driverId,
          deviceId,
          randomUUID(),
          "a".repeat(64),
          JSON.stringify(summary),
        ],
      );
    let detail = await read();
    await expect(finish(detail.work.basis)).rejects.toMatchObject({
      code: "SETTLEMENT_ROUTE_NOT_FINISHED",
    });
    await expect(
      finish(detail.work.basis, randomUUID(), null),
    ).rejects.toMatchObject({ code: "MOBILE_UNAUTHENTICATED" });
    await expect(
      finish(detail.work.basis, randomUUID(), f.members[1].authorization),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const basis of [null, "", 1])
      await expect(
        completeDriverWork(f.db.pool, auth, f.executionId, {
          commandId: randomUUID(),
          basis,
        }),
      ).rejects.toMatchObject({ code: "WORK_REVIEW_REQUIRED" });
    for (const [index, method] of ["cash", "mixed", "credit"].entries()) {
      // A currency may change precision between collections; identity stays the same.
      if (index === 1) {
        const target = f.shipmentRows[index];
        const observation = financialObservation();
        observation.picking.id = Number(target.picking_id);
        observation.picking.partnerId = Number(target.partner_id);
        observation.relatedPickings = [structuredClone(observation.picking)];
        observation.order.id = Number(target.order_id);
        observation.moves[0].id = Number(target.picking_id);
        observation.moves[0].productId = Number(target.picking_id);
        observation.moves[0].pickingId = Number(target.picking_id);
        observation.saleLines[0].productId = Number(target.picking_id);
        observation.currency = {
          ...observation.currency,
          rounding: "0.1",
          decimalPlaces: 1,
        };
        await transaction(f.db.pool, (sql) =>
          persistFinancialSnapshot(
            sql,
            buildFinancialSnapshot(
              {
                source: target.source,
                pickingId: Number(target.picking_id),
                orderId: Number(target.order_id),
                partnerId: Number(target.partner_id),
              },
              observation,
            ),
            60,
            1,
          ),
        );
        detail = await read();
      }
      const order = detail.orders.find(
        (order) => order.shipmentId === f.shipmentRows[index].id,
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
          method,
          tendered: method === "credit" ? "0" : "20",
          change: "0",
          note: "",
          ...(method === "mixed"
            ? { cashReceived: "7", transferReceived: "13" }
            : {}),
        },
        f.timezone,
      );
    }
    await f.finish();
    detail = await read();
    expect(detail.work).toMatchObject({
      eligible: false,
      reason: "WORK_SETTLEMENT_PENDING",
      completion: null,
    });
    expect(detail.routeSettlement).toMatchObject({
      eligible: true,
      paymentIds: expect.any(Array),
    });
    await expect(sqlFinish(detail.work.summary)).rejects.toThrow(
      "WORK_SETTLEMENT_PENDING",
    );
    await expect(finish(detail.work.basis)).rejects.toMatchObject({
      code: "WORK_SETTLEMENT_PENDING",
    });
    const preview = detail.routeSettlement.basis;
    for (const basis of [null, 1, ""])
      await expect(
        requestSettlement(f.db.pool, auth, f.executionId, {
          commandId: randomUUID(),
          shipmentId: null,
          basis,
        }),
      ).rejects.toMatchObject({ code: "SETTLEMENT_REVIEW_REQUIRED" });
    const individual = await requestSettlement(f.db.pool, auth, f.executionId, {
      commandId: randomUUID(),
      shipmentId: f.shipmentRows[0].id,
    });
    detail = await read();
    expect(detail.routeSettlement.reason).toBe("SETTLEMENT_REQUEST_PENDING");
    const decide = async (id: string, decision = "accepted") => {
      const current = (await read()).requests.find(
        (request) => request.id === id,
      )!;
      return decideSettlement(f.db.pool, receiver, id, {
        commandId: randomUUID(),
        version: current.version,
        basis: current.basis,
        decision,
        note: "Recibido en bodega",
      });
    };
    await decide(individual.id);
    await expect(
      requestSettlement(f.db.pool, auth, f.executionId, {
        commandId: randomUUID(),
        shipmentId: null,
        basis: preview,
      }),
    ).rejects.toMatchObject({ code: "SETTLEMENT_VERSION_CHANGED" });
    detail = await read();
    expect(detail.routeSettlement.paymentIds).toHaveLength(2);
    expect(detail.work.summary.totals[0].total).toBe("60");
    const groupCommand = randomUUID();
    const rawGroup = {
      commandId: groupCommand,
      shipmentId: null,
      basis: detail.routeSettlement.basis,
    };
    const group = await requestSettlement(
      f.db.pool,
      auth,
      f.executionId,
      rawGroup,
    );
    expect(
      await requestSettlement(f.db.pool, auth, f.executionId, rawGroup),
    ).toMatchObject({ id: group.id, duplicate: true });
    await expect(
      requestSettlement(f.db.pool, auth, f.executionId, {
        ...rawGroup,
        basis: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "COMMAND_REUSED" });
    await expect(finish(detail.work.basis)).rejects.toMatchObject({
      code: "WORK_SETTLEMENT_PENDING",
    });
    await decide(group.id, "rejected");
    detail = await read();
    expect(detail.routeSettlement.eligible).toBe(true);
    const acceptedGroup = await requestSettlement(
      f.db.pool,
      auth,
      f.executionId,
      {
        commandId: randomUUID(),
        shipmentId: null,
        basis: detail.routeSettlement.basis,
      },
    );
    await decide(acceptedGroup.id);
    detail = await read();
    expect(detail.work).toMatchObject({
      eligible: true,
      summary: { deliveredOrders: 3, incidents: 0, totals: [{ total: "60" }] },
    });
    expect(detail.routeSettlement.reason).toBe("SETTLEMENT_NOTHING_PENDING");
    await expect(finish("0".repeat(64))).rejects.toMatchObject({
      code: "WORK_VERSION_CHANGED",
    });
    for (const summary of [
      { ...detail.work.summary, deliveredOrders: 25 },
      { ...detail.work.summary, incidents: 4 },
      { ...detail.work.summary, paymentIds: [] },
      { ...detail.work.summary, totals: [] },
      {
        ...detail.work.summary,
        totals: [{ ...detail.work.summary.totals[0], total: "61" }],
      },
      {
        ...detail.work.summary,
        totals: [
          {
            ...detail.work.summary.totals[0],
            currency: {
              ...detail.work.summary.totals[0].currency,
              rounding: "1",
            },
          },
        ],
      },
    ])
      await expect(sqlFinish(summary)).rejects.toThrow("WORK_SUMMARY_INVALID");
    await expect(
      sqlFinish(
        detail.work.summary,
        f.members[1].deviceId,
        f.members[1].driverId,
      ),
    ).rejects.toThrow("WORK_SETTLEMENT_PENDING");
    const fingerprint = await driverPublicationFingerprint(
      f.db.pool,
      f.members[0].driverId,
    );
    const otherFingerprint = await driverPublicationFingerprint(
      f.db.pool,
      f.members[1].driverId,
    );
    const commandId = randomUUID();
    const results = await Promise.all([
      finish(detail.work.basis, commandId),
      finish(detail.work.basis, commandId),
    ]);
    expect(results.map((result) => result.duplicate).sort()).toEqual([
      false,
      true,
    ]);
    expect(results[0].summary).toEqual(detail.work.summary);
    expect(await finish(detail.work.basis)).toMatchObject({
      duplicate: true,
      summary: detail.work.summary,
    });
    await expect(finish("1".repeat(64), commandId)).rejects.toMatchObject({
      code: "COMMAND_REUSED",
    });
    expect(
      await driverPublicationFingerprint(f.db.pool, f.members[0].driverId),
    ).not.toBe(fingerprint);
    expect(
      await driverPublicationFingerprint(f.db.pool, f.members[1].driverId),
    ).toBe(otherFingerprint);
    expect(
      (await readSettlementDetail(f.db.pool, receiver, f.executionId)).work
        .completion?.summary,
    ).toEqual(detail.work.summary);
    await expect(
      f.db.pool.query(
        "UPDATE route_driver_work_completions SET snapshot='{}'::jsonb WHERE execution_id=$1",
        [f.executionId],
      ),
    ).rejects.toBeTruthy();
    await expect(
      f.db.pool.query(
        "DELETE FROM route_driver_work_completions WHERE execution_id=$1",
        [f.executionId],
      ),
    ).rejects.toBeTruthy();
    await f.db.pool.query("UPDATE rutas_installation SET schema_version=39");
    await migrate(f.db.pool, f.db.config.instanceId);
    await migrate(f.db.pool, f.db.config.instanceId);
    expect(
      (
        await f.db.pool.query(
          "SELECT indexdef FROM pg_indexes WHERE tablename='route_driver_work_completions' AND indexname='driver_work_owner'",
        )
      ).rows[0].indexdef,
    ).toContain("(driver_id)");
    expect((await read()).work.completion?.summary).toEqual(
      detail.work.summary,
    );
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int AS n FROM route_driver_mobile_audit WHERE action='mobile.work.completed'",
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await f.close();
  }
}, 120000);
