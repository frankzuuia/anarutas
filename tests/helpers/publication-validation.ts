import { createHash, randomUUID } from "node:crypto";
import { executionFixture } from "./driver-execution";
import { orderBoard } from "../../src/core/orders";
import {
  routeFingerprint,
  vehicleRouteFingerprints,
} from "../../src/core/route-fingerprint";
import { financialObservation } from "./financial";
import { buildFinancialSnapshot } from "../../src/core/financial-policy";

/** Real isolated PG/domain fixtures, no remote Odoo/Google substitution. */
export async function publicationValidationFixture() {
  const f = await executionFixture({ orderCount: 5, now: new Date() });
  await f.db.pool.query(
    "DELETE FROM route_plan_publications WHERE plan_id=$1",
    [f.planId],
  );
  for (const member of f.members) await f.db.pool.query(
    "INSERT INTO route_mobile_push_registrations(device_id,driver_id,fid) VALUES($1,$2,$3)",
    [member.deviceId, member.driverId, randomUUID()],
  );
  await f.db.pool.query(
    "UPDATE route_shipments SET vehicle_id=NULL WHERE plan_id=$1 AND snapshot->>'orderName'='S5'",
    [f.planId],
  );
  const setStatus = (id: string, status: string | null) =>
    f.db.pool.query(
      "UPDATE route_shipments SET snapshot=jsonb_set(snapshot,'{fulfillmentStatus}',COALESCE(to_jsonb($2::text),'null'::jsonb)) WHERE id=$1",
      [id, status],
    );
  const storeCalculation = async () => {
    const board = await orderBoard(f.db.pool, f.planId);
    const metrics = {
      travelDistanceMeters: 1000,
      travelDurationSeconds: 600,
      waitDurationSeconds: 0,
      totalDurationSeconds: 600,
      performedShipmentCount: board.shipments.filter((s) => s.vehicle_id)
        .length,
    };
    await f.db.pool.query(
      `INSERT INTO route_optimization_runs
       (id,plan_id,base_plan_version,applied_plan_version,request_hash,input_fingerprint,metrics,routes,skipped,created_by,vehicle_input_hashes)
       VALUES($1,$2,$3,$3,$4,$5,$6,$7,'[]',$8,$9)`,
      [
        randomUUID(),
        f.planId,
        board.plan.version,
        createHash("sha256").update(randomUUID()).digest("hex"),
        routeFingerprint(board, 0),
        JSON.stringify(metrics),
        JSON.stringify(
          board.vehicles.map((vehicle) => ({
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            encodedPolyline: null,
            segmentPolylines: [],
            departureAt: f.now.toISOString(),
            finishedAt: f.now.toISOString(),
            trafficMode: "static",
            metrics,
            stops: board.shipments
              .filter((s) => s.vehicle_id === vehicle.id)
              .map((s, index) => ({
                shipmentId: s.id,
                position: index + 1,
                eta: f.now.toISOString(),
                travelDistanceMeters: 1000,
                travelDurationSeconds: 600,
                waitDurationSeconds: 0,
              })),
          })),
        ),
        f.actor,
        JSON.stringify(vehicleRouteFingerprints(board, 0)),
      ],
    );
    return board;
  };
  const workerObservation = async (id: string) => {
    const row = (
      await f.db.pool.query(
        "SELECT source,snapshot FROM route_shipments WHERE id=$1",
        [id],
      )
    ).rows[0];
    const shipment = row.snapshot,
      observation = financialObservation();
    observation.picking.id = shipment.pickingId;
    observation.picking.partnerId = shipment.partnerId;
    observation.order.id = shipment.orderId;
    observation.moves[0].id = shipment.lines[0].moveId;
    observation.moves[0].pickingId = shipment.pickingId;
    observation.moves[0].productId = shipment.lines[0].productId;
    observation.saleLines[0].productId = shipment.lines[0].productId;
    observation.relatedPickings = [observation.picking];
    return buildFinancialSnapshot(
      {
        source: row.source,
        pickingId: shipment.pickingId,
        orderId: shipment.orderId,
        partnerId: shipment.partnerId,
      },
      observation,
    );
  };
  return { ...f, setStatus, storeCalculation, workerObservation };
}
