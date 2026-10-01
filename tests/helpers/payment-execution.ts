import { randomUUID } from "node:crypto";
import { executionFixture } from "./driver-execution";
import { financialObservation } from "./financial";
import { buildFinancialSnapshot } from "../../src/core/financial-policy";
import { persistFinancialSnapshot } from "../../src/core/financial-store";
import { transaction } from "../../src/core/database";
import { readDriverExecution } from "../../src/core/driver-execution-read";
import { executeStopCommand } from "../../src/core/driver-stop-command";
import { executeDriverOrderCommand } from "../../src/core/driver-order-command";
import { completeDriverRoute } from "../../src/core/driver-route-completion";
import { saveRoutingSettings } from "../../src/core/routing-settings";
import { readDriverPlan } from "../../src/core/driver-mobile-route";

// Real PG and operational commands. Domain observations are persisted unit inputs, not Odoo API mocks.
export async function paymentExecutionFixture(
  options: {
    collectAtFirstStop?: boolean;
    orderCount?: number;
    warehouseRequired?: boolean;
    now?: Date;
  } = {},
) {
  const f = await executionFixture({ orderCount: options.orderCount, now: options.now });
  try {
    // Financial regressions explicitly exercise the strict warehouse policy;
    // dedicated temporary-mode tests override this real persisted setting.
    await f.db.pool.query(
      "UPDATE route_driver_operation_settings SET settlement_require_warehouse=$1 WHERE singleton=true",
      [options.warehouseRequired ?? true],
    );
    await f.start();
    const state = () =>
      readDriverExecution(
        f.db.pool,
        f.members[0].driverId,
        f.planId,
        f.timezone,
      );
    const shipmentRows = (
      await f.db.pool.query(
        "SELECT * FROM route_shipments WHERE vehicle_id=$1 ORDER BY picking_id",
        [f.members[0].vehicleId],
      )
    ).rows;
    for (const s of shipmentRows) {
      const observation = financialObservation();
      observation.picking.id = Number(s.picking_id);
      observation.picking.partnerId = Number(s.partner_id);
      observation.relatedPickings = [structuredClone(observation.picking)];
      observation.order.id = Number(s.order_id);
      observation.moves[0].id = Number(s.picking_id);
      observation.moves[0].productId = Number(s.picking_id);
      observation.moves[0].pickingId = Number(s.picking_id);
      observation.saleLines[0].productId = Number(s.picking_id);
      await transaction(f.db.pool, (sql) =>
        persistFinancialSnapshot(
          sql,
          buildFinancialSnapshot(
            {
              source: s.source,
              pickingId: Number(s.picking_id),
              orderId: Number(s.order_id),
              partnerId: Number(s.partner_id),
            },
            observation,
          ),
          60,
          1,
        ),
      );
    }
    const sample = {
      latitude: 20.64,
      longitude: -103.4,
      accuracyMeters: 5,
      ageMilliseconds: 0,
      capturedAt: f.now.toISOString(),
      mock: false,
    };
    for (let index = 0; index < shipmentRows.length; index++) {
      let route = await state(),
        stop = route.stops[index];
      const identity = () => ({
        commandId: randomUUID(),
        executionId: route.id,
        publicationRevision: route.publicationRevision,
        executionRevision: route.revision,
        stopVersion: stop.version,
        visitSequence: stop.visitSequence,
        policyVersion: route.policy.version,
      });
      await executeStopCommand(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        stop.id,
        "arrival",
        { ...identity(), sample },
        f.timezone,
        f.now,
      );
      route = await state();
      stop = route.stops[index];
      if (options.collectAtFirstStop) break;
      await executeDriverOrderCommand(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        stop.id,
        stop.shipmentIds[0],
        {
          ...identity(),
          kind: "deliver",
          orderVersion: stop.orderStates[0].version,
        },
        f.timezone,
        f.now,
      );
    }
    const executionId = (await state()).id;
    let depotConfigured = false;
    const finish = async () => {
      if (!depotConfigured)
        await saveRoutingSettings(f.db.pool, f.actor, {
          expectedVersion: 0,
          depotAddress: "Bodega QA",
          depotLocation: {
            latitude: 20.64,
            longitude: -103.4,
            placeId: "qa-depot",
          },
          departureTime: "08:00",
          serviceMinutes: 10,
        });
      depotConfigured = true;
      const route = await state(),
        plan = await readDriverPlan(
          f.db.pool,
          f.members[0].driverId,
          f.planId,
          f.timezone,
        );
      return completeDriverRoute(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        {
          commandId: randomUUID(),
          executionId,
          publicationRevision: route.publicationRevision,
          executionRevision: route.revision,
          policyVersion: route.policy.version,
          depotVersion: plan.departure!.version,
          confirmed: true,
          sample,
        },
        f.now,
      );
    };
    return { ...f, executionId, shipmentRows, finish, state };
  } catch (error) {
    await f.close();
    throw error;
  }
}
