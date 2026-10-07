import { randomUUID } from "node:crypto";
import { paymentExecutionFixture } from "./payment-execution";
import { executeStopCommand } from "../../src/core/driver-stop-command";
import { readMobileFinanceDetail } from "../../src/core/finance-read";
import { confirmOrderPayment } from "../../src/core/payments";

export async function unloadingLearningFixture() {
  const f = await paymentExecutionFixture({
    collectAtFirstStop: true,
    orderCount: 12,
    partnerIds: [1, 1, 2, 1, 2, 1, 5, 1, 6, 1, 7, 1],
    now: new Date(Date.now() - 12 * 3600_000),
  });
  const customerId = (
    await f.db.pool.query(
      "SELECT id FROM route_customers WHERE odoo_partner_id=1",
    )
  ).rows[0].id as string;
  await f.db.pool.query(
    "UPDATE route_customers SET unloading_minutes=15 WHERE id=$1",
    [customerId],
  );
  const arrive = async (stopIndex: number, at: Date) => {
    const route = await f.state(),
      stop = route.stops[stopIndex];
    await executeStopCommand(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stop.id,
      "arrival",
      {
        commandId: randomUUID(),
        executionId: route.id,
        publicationRevision: route.publicationRevision,
        executionRevision: route.revision,
        stopVersion: stop.version,
        policyVersion: route.policy.version,
        sample: {
          latitude: stop.latitude,
          longitude: stop.longitude,
          accuracyMeters: 5,
          ageMilliseconds: 0,
          capturedAt: at.toISOString(),
          mock: false,
        },
      },
      f.timezone,
      at,
    );
  };
  const command = async (
    stopIndex: number,
    orderIndex: number,
    capturedAt?: unknown,
  ) => {
    const route = await f.state(),
      stop = route.stops[stopIndex],
      order = stop.orderStates[orderIndex];
    const detail = (
      await readMobileFinanceDetail(
        f.db.pool,
        f.members[0].authorization,
        f.executionId,
      )
    ).orders.find((o) => o.shipmentId === order.shipmentId)!;
    return {
      commandId: randomUUID(),
      shipmentId: order.shipmentId,
      basis: detail.basis,
      captureVersion: 2,
      method: "cash",
      tendered: detail.financial!.totals!.net,
      change: "0",
      note: "",
      attention: {
        planId: f.planId,
        stopId: stop.id,
        publicationRevision: route.publicationRevision,
        executionRevision: route.revision,
        stopVersion: stop.version,
        visitSequence: stop.visitSequence,
        orderVersion: order.version,
        productIncidentsAcknowledged: true,
        ...(capturedAt === undefined ? {} : { capturedAt }),
      },
    };
  };
  const collect = (
    payload: Awaited<ReturnType<typeof command>>,
    authorization = f.members[0].authorization,
  ) =>
    confirmOrderPayment(
      f.db.pool,
      authorization,
      f.executionId,
      payload,
      f.timezone,
    );
  const visit = async (stopIndex: number, minutes: number) => {
    const arrival = new Date(f.now.getTime() + stopIndex * 3600_000);
    await arrive(stopIndex, arrival);
    return collect(
      await command(
        stopIndex,
        0,
        new Date(arrival.getTime() + minutes * 60_000).toISOString(),
      ),
    );
  };
  return { ...f, customerId, arrive, command, collect, visit };
}
