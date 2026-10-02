import { createHash, randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { createPlan } from "../../src/core/plans";
import {
  orderBoard,
  persistImportPage,
  selectPlanVehicles,
  moveShipment,
} from "../../src/core/orders";
import { getRoutingSettings } from "../../src/core/routing-settings";
import {
  routeFingerprint,
  vehicleRouteFingerprints,
} from "../../src/core/route-fingerprint";
import { publishRoutes } from "../../src/core/route-publications";
import { uploadDriverUnitPhoto } from "../../src/core/unit-photos";
import { startDriverRoute } from "../../src/core/route-start";
import type { executionFixture } from "./driver-execution";

type Fixture = Awaited<ReturnType<typeof executionFixture>>;
// Persisted calculation inputs for contract QA, not a simulated provider or an
// assertion that Google routing ran. All publication/photo/start calls are real.
export async function prepareSameDayPlan(
  f: Fixture,
  options: {
    planId?: string;
    publish?: boolean;
    member?: Fixture["members"][number];
  } = {},
) {
  const member = options.member ?? f.members[0];
  const planId =
    options.planId ??
    (
      await createPlan(f.db.pool, f.actor, {
        date: (await orderBoard(f.db.pool, f.planId)).plan.service_date,
        label: "Segunda salida",
        commandId: randomUUID(),
      })
    ).id;
  let board = await orderBoard(f.db.pool, planId);
  await selectPlanVehicles(f.db.pool, f.actor, planId, {
    vehicleIds: [member.vehicleId],
    expectedVersion: board.plan.version,
  });
  const original = (
    await f.db.pool.query(
      "SELECT source,max(picking_id)::text AS last_id FROM route_shipments GROUP BY source",
    )
  ).rows[0];
  const orderNumber = Number(original.last_id) + 1;
  await persistImportPage(f.db.pool, f.actor, planId, {
    fingerprint: original.source,
    shipments: [
      {
        pickingId: orderNumber,
        pickingName: `OUT/${orderNumber}`,
        orderId: orderNumber,
        orderName: `S${orderNumber}`,
        partnerId: 1,
        customerName: "Cliente 1",
        address: "Calle 1",
        validatedAt: f.now.toISOString(),
        promisedAt: null,
        backorderId: null,
        lines: [
          {
            moveId: orderNumber,
            productId: orderNumber,
            name: "Producto nueva salida",
            quantity: 1,
            unit: "kg",
          },
        ],
      },
    ],
    nextCursor: orderNumber,
    ceiling: orderNumber,
    hasMore: false,
    inspected: 1,
    excluded: 0,
  });
  board = await orderBoard(f.db.pool, planId);
  await moveShipment(f.db.pool, f.actor, planId, {
    shipmentId: board.shipments[0].id,
    vehicleId: member.vehicleId,
    beforeId: null,
    expectedVersion: board.plan.version,
  });
  board = await orderBoard(f.db.pool, planId);
  const settings = await getRoutingSettings(f.db.pool);
  const metrics = {
    travelDistanceMeters: 1000,
    travelDurationSeconds: 600,
    waitDurationSeconds: 0,
    totalDurationSeconds: 600,
    performedShipmentCount: 1,
  };
  await f.db.pool.query(
    `INSERT INTO route_optimization_runs
    (id,plan_id,base_plan_version,applied_plan_version,request_hash,input_fingerprint,metrics,routes,skipped,created_by,vehicle_input_hashes)
    VALUES($1,$2,$3,$3,$4,$5,$6,$7,'[]',$8,$9)`,
    [
      randomUUID(),
      planId,
      board.plan.version,
      createHash("sha256").update(randomUUID()).digest("hex"),
      routeFingerprint(board, settings.version),
      JSON.stringify(metrics),
      JSON.stringify([
        {
          vehicleId: member.vehicleId,
          vehicleName: board.vehicles[0].name,
          encodedPolyline: null,
          segmentPolylines: [],
          departureAt: f.now.toISOString(),
          finishedAt: new Date(f.now.getTime() + 600_000).toISOString(),
          trafficMode: "static",
          metrics,
          stops: [
            {
              shipmentId: board.shipments[0].id,
              position: 1,
              eta: new Date(f.now.getTime() + 600_000).toISOString(),
              travelDistanceMeters: 1000,
              travelDurationSeconds: 600,
              waitDurationSeconds: 0,
            },
          ],
        },
      ]),
      f.actor,
      JSON.stringify(vehicleRouteFingerprints(board, settings.version)),
    ],
  );
  if (options.publish !== false)
    await publishRoutes(f.db.pool, f.actor, planId, {
      scope: "all",
      expectedVersion: board.plan.version,
    });
  const photos = async () => {
    for (let index = 0; index < 5; index++) {
      const rgb = randomBytes(3);
      const bytes = await sharp({
        create: {
          width: 24,
          height: 24,
          channels: 3,
          background: { r: rgb[0], g: rgb[1], b: rgb[2] },
        },
      })
        .jpeg()
        .toBuffer();
      await uploadDriverUnitPhoto(
        f.db.pool,
        member.driverId,
        planId,
        bytes,
        "image/jpeg",
        f.timezone,
        f.photoRoot,
        f.now,
      );
    }
  };
  const start = () =>
    startDriverRoute(
      f.db.pool,
      member.driverId,
      planId,
      1,
      f.timezone,
      f.now,
      f.photoRoot,
    );
  return { planId, member, photos, start, board };
}
