import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { paymentExecutionFixture } from "./helpers/payment-execution";
import { readMobileFinanceDetail } from "../src/core/finance-read";
import { requestSettlement, decideSettlement } from "../src/core/settlements";
import { completeDriverWork } from "../src/core/route-work";
import { confirmOrderPayment } from "../src/core/payments";
import { createUser } from "../src/core/auth";
import { migrate, transaction } from "../src/core/database";
import { driverPublicationFingerprint } from "../src/core/driver-mobile-events";
import { settlementWarehouseRequired } from "../src/core/settlement-warehouse-policy";

it("tests and restores the real runtime warehouse policy without fabricating a GPS completion or changing receipt integrity", async () => {
  const f = await paymentExecutionFixture({ warehouseRequired: false });
  try {
    const auth = f.members[0].authorization;
    const read = () => readMobileFinanceDetail(f.db.pool, auth, f.executionId);
    const policy = (required: boolean) =>
      f.db.pool.query(
        "UPDATE route_driver_operation_settings SET settlement_require_warehouse=$1 WHERE singleton=true",
        [required],
      );
    const request = (basis: string, commandId = randomUUID()) =>
      requestSettlement(f.db.pool, auth, f.executionId, {
        commandId,
        shipmentId: null,
        basis,
        warehouseRequired: false,
      });
    const finish = (basis: string, commandId = randomUUID()) =>
      completeDriverWork(f.db.pool, auth, f.executionId, {
        commandId,
        basis,
        warehouseRequired: false,
      });
    const directRequest = () =>
      f.db.pool.query(
        `INSERT INTO route_settlement_requests(id,execution_id,driver_id,device_id,command_id,request_hash,scope,snapshot,requested_at)
      VALUES($1,$2,$3,$4,$5,$6,'route',$7,now())`,
        [
          randomUUID(),
          f.executionId,
          f.members[0].driverId,
          f.members[0].deviceId,
          randomUUID(),
          "a".repeat(64),
          JSON.stringify({ paymentIds: [randomUUID()], totals: [] }),
        ],
      );
    const directWork = (summary: unknown) =>
      f.db.pool.query(
        `INSERT INTO route_driver_work_completions(execution_id,driver_id,device_id,command_id,request_hash,completed_at,snapshot)
      VALUES($1,$2,$3,$4,$5,now(),$6)`,
        [
          f.executionId,
          f.members[0].driverId,
          f.members[0].deviceId,
          randomUUID(),
          "a".repeat(64),
          JSON.stringify(summary),
        ],
      );
    let detail = await read();
    expect(detail.route.completedAt).toBeNull();
    expect(detail.routeSettlement.warehouseRequired).toBe(false);
    expect(detail.routeSettlement.reason).toBe("SETTLEMENT_PAYMENTS_MISSING");
    await expect(request(detail.routeSettlement.basis)).rejects.toMatchObject({
      code: "SETTLEMENT_PAYMENTS_MISSING",
    });
    await expect(directRequest()).rejects.toThrow(
      "SETTLEMENT_EXECUTION_INVALID",
    );
    for (const [index, method] of ["cash", "transfer", "credit"].entries()) {
      detail = await read();
      const order = detail.orders.find(
        (o) => o.shipmentId === f.shipmentRows[index].id,
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
        },
        f.timezone,
      );
    }
    detail = await read();
    expect(detail.routeSettlement.eligible).toBe(true);
    // A receipt does not prove every current order is final. Exercise a real
    // persisted legacy inconsistency and restore this isolated test record.
    await f.db.pool.query(
      "UPDATE route_driver_execution_orders SET status='open' WHERE execution_id=$1 AND shipment_id=$2",
      [f.executionId, f.shipmentRows[0].id],
    );
    expect((await read()).routeSettlement.reason).toBe(
      "SETTLEMENT_ORDERS_NOT_DELIVERED",
    );
    await expect(request(detail.routeSettlement.basis)).rejects.toMatchObject({
      code: "SETTLEMENT_ORDERS_NOT_DELIVERED",
    });
    await expect(directRequest()).rejects.toThrow(
      "SETTLEMENT_EXECUTION_INVALID",
    );
    expect(
      (
        await f.db.pool.query("SELECT route_settlement_ready($1) ready", [
          f.executionId,
        ])
      ).rows[0].ready,
    ).toBe(false);
    await f.db.pool.query(
      "UPDATE route_driver_execution_orders SET status='delivered' WHERE execution_id=$1 AND shipment_id=$2",
      [f.executionId, f.shipmentRows[0].id],
    );
    expect(detail.work.reason).toBe("WORK_SETTLEMENT_PENDING");
    await expect(finish(detail.work.basis)).rejects.toMatchObject({
      code: "WORK_SETTLEMENT_PENDING",
    });
    await expect(directWork(detail.work.summary)).rejects.toThrow(
      "WORK_SETTLEMENT_PENDING",
    );
    const fingerprint = await driverPublicationFingerprint(
      f.db.pool,
      f.members[0].driverId,
    );
    await policy(true);
    expect(
      await driverPublicationFingerprint(f.db.pool, f.members[0].driverId),
    ).not.toBe(fingerprint);
    detail = await read();
    expect(detail.routeSettlement).toMatchObject({
      eligible: false,
      warehouseRequired: true,
      reason: "SETTLEMENT_ROUTE_NOT_FINISHED",
    });
    await expect(request(detail.routeSettlement.basis)).rejects.toMatchObject({
      code: "SETTLEMENT_ROUTE_NOT_FINISHED",
    });
    await expect(directRequest()).rejects.toThrow(
      "SETTLEMENT_EXECUTION_INVALID",
    );
    await f.db.pool.query("UPDATE rutas_installation SET schema_version=40");
    await migrate(f.db.pool, f.db.config.instanceId);
    await migrate(f.db.pool, f.db.config.instanceId);
    expect((await read()).routeSettlement.warehouseRequired).toBe(true);
    await policy(false);
    detail = await read();
    const commandId = randomUUID();
    const requestBasis = detail.routeSettlement.basis;
    const requested = await request(requestBasis, commandId);
    expect(await request(requestBasis, commandId)).toMatchObject({
      id: requested.id,
      duplicate: true,
    });
    const receiver = (
      await createUser(f.db.pool, f.actor, {
        name: "Receptor prueba",
        login: "test-warehouse-receiver",
        password: randomUUID(),
        role: "settlement",
      })
    ).id;
    detail = await read();
    const packet = detail.requests.find((r) => r.id === requested.id)!;
    await decideSettlement(f.db.pool, receiver, packet.id, {
      commandId: randomUUID(),
      version: packet.version,
      basis: packet.basis,
      decision: "accepted",
      note: "Prueba autorizada sin bodega",
    });
    detail = await read();
    expect(detail.work.eligible).toBe(true);
    await policy(true);
    await expect(finish(detail.work.basis)).rejects.toMatchObject({
      code: "SETTLEMENT_ROUTE_NOT_FINISHED",
    });
    await expect(directWork(detail.work.summary)).rejects.toThrow(
      "WORK_SETTLEMENT_PENDING",
    );
    await policy(false);
    const workCommand = randomUUID();
    const results = await Promise.all([
      finish(detail.work.basis, workCommand),
      finish(detail.work.basis, workCommand),
    ]);
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
    expect(results[0].summary).toMatchObject({
      deliveredOrders: 3,
      incidents: 0,
      totals: [{ total: "60" }],
    });
    await policy(true);
    expect(await finish(detail.work.basis, workCommand)).toMatchObject({
      duplicate: true,
      summary: results[0].summary,
    });
    expect(await request(requestBasis, commandId)).toMatchObject({
      duplicate: true,
    });
    expect((await f.state()).completedAt).toBeNull();
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int n FROM route_driver_execution_completions WHERE execution_id=$1",
          [f.executionId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await f.db.pool.query(
          "SELECT details FROM route_driver_mobile_audit WHERE action='mobile.work.completed' AND driver_id=$1",
          [f.members[0].driverId],
        )
      ).rows[0].details.warehouseRequired,
    ).toBe(false);
    expect(
      (
        await f.db.pool.query(
          "SELECT pg_get_expr(d.adbin,d.adrelid) value FROM pg_attribute a JOIN pg_attrdef d ON (d.adrelid,d.adnum)=(a.attrelid,a.attnum) WHERE a.attrelid='route_driver_operation_settings'::regclass AND a.attname='settlement_require_warehouse'",
        )
      ).rows[0].value,
    ).toBe("false");
    await expect(
      transaction(f.db.pool, async (sql) => {
        await sql.query("DELETE FROM route_driver_operation_settings");
        return settlementWarehouseRequired(sql);
      }),
    ).rejects.toMatchObject({ code: "OPERATION_SETTINGS_MISSING" });
  } finally {
    await f.close();
  }
}, 120000);

it("blocks an active unfinished route even when the temporary exception is enabled", async () => {
  const f = await paymentExecutionFixture({
    warehouseRequired: false,
    collectAtFirstStop: true,
  });
  try {
    const auth = f.members[0].authorization;
    const detail = await readMobileFinanceDetail(
      f.db.pool,
      auth,
      f.executionId,
    );
    expect(detail.routeSettlement.reason).toBe(
      "SETTLEMENT_ORDERS_NOT_DELIVERED",
    );
    expect(detail.work.eligible).toBe(false);
    await expect(
      requestSettlement(f.db.pool, auth, f.executionId, {
        commandId: randomUUID(),
        shipmentId: null,
        basis: detail.routeSettlement.basis,
      }),
    ).rejects.toMatchObject({ code: "SETTLEMENT_ORDERS_NOT_DELIVERED" });
    expect(
      (
        await f.db.pool.query("SELECT route_settlement_ready($1) ready", [
          f.executionId,
        ])
      ).rows[0].ready,
    ).toBe(false);
  } finally {
    await f.close();
  }
}, 120000);
