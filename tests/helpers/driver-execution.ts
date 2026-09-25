import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { startPostgres } from "./postgres";
import { bootstrap } from "../../src/core/auth";
import { createDriver, createVehicle, assignDriver } from "../../src/core/fleet";
import { createPlan } from "../../src/core/plans";
import { persistImportPage, orderBoard, selectPlanVehicles } from "../../src/core/orders";
import { routePublicationSnapshot } from "../../src/core/route-publication-content";
import { configureMobileAccess, enrollMobileDevice } from "../../src/core/driver-mobile-auth";
import { uploadDriverUnitPhoto } from "../../src/core/unit-photos";
import { startDriverRoute } from "../../src/core/route-start";

// Real isolated PostgreSQL, signatures, image files and start transaction. No HTTP/API mocks.
// The persisted publication is a fixture for execution, not a claim of a Google calculation.
export async function executionFixture() {
  const db = await startPostgres();
  const photoRoot = await mkdtemp(join(tmpdir(), "rutas-execution-"));
  const oldPepper = process.env.RUTAS_DRIVER_PIN_PEPPER;
  process.env.RUTAS_DRIVER_PIN_PEPPER = randomUUID() + randomUUID();
  const close = async () => {
    if (oldPepper === undefined) delete process.env.RUTAS_DRIVER_PIN_PEPPER;
    else process.env.RUTAS_DRIVER_PIN_PEPPER = oldPepper;
    await db.close();
    await rm(photoRoot, { recursive: true, force: true });
  };
  try {
    const actor = (await bootstrap(db.pool, db.config, { token: db.config.bootstrapToken,
      name: "Execution QA", login: "execution-qa", password: randomUUID() })).id;
    const members: { driverId: string; vehicleId: string; deviceId: string; authorization: string }[] = [];
    for (let index = 0; index < 2; index++) {
      const driver = await createDriver(db.pool, actor, { id: randomUUID(), name: `Chofer ${index}`,
        phone: `331000000${index}`, emergency_name: "", emergency_phone: "", blood_type: "", active: true });
      const vehicle = await createVehicle(db.pool, actor, { id: randomUUID(), name: `Unidad ${index}`,
        brand: "QA", model: "QA", plate: randomUUID().slice(0, 8), mileage: 0, fuel: "Gasolina", available: true });
      await assignDriver(db.pool, actor, vehicle.id, { driver_id: driver.id, expectedVersion: vehicle.version });
      await configureMobileAccess(db.pool, actor, driver.id, { pin: "0123", expectedMobileVersion: 0 });
      const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const enrollment = await enrollMobileDevice(db.pool, { phone: driver.phone, pin: "0123",
        publicKey: keys.publicKey.export({ type: "spki", format: "pem" }).toString() });
      members.push({ driverId: driver.id, vehicleId: vehicle.id, deviceId: enrollment.deviceId, authorization: `Bearer ${enrollment.token}` });
    }
    const plan = await createPlan(db.pool, actor, { date: "2026-09-24", label: "Ejecución QA" });
    await selectPlanVehicles(db.pool, actor, plan.id, { vehicleIds: members.map(m => m.vehicleId), expectedVersion: plan.version });
    await persistImportPage(db.pool, actor, plan.id, {
      fingerprint: createHash("sha256").update("execution-qa").digest("hex"),
      shipments: [1, 2, 3, 4].map(index => ({ pickingId: index, pickingName: `OUT/${index}`, orderId: index,
        orderName: `S${index}`, partnerId: index === 4 ? 1 : index, customerName: `Cliente ${index === 4 ? 1 : index}`,
        address: `Calle ${index === 4 ? 1 : index}`, validatedAt: "2026-09-24T12:00:00.000Z", promisedAt: null,
        backorderId: null, lines: [{ moveId: index, productId: index, name: `Producto ${index}`, quantity: 2, unit: "kg" }] })),
      nextCursor: 4, ceiling: 4, hasMore: false, inspected: 4, excluded: 0,
    });
    await db.pool.query("UPDATE route_customers SET latitude=20.64,longitude=-103.4,location_status='confirmed'");
    await db.pool.query("INSERT INTO route_customer_windows(id,customer_id,position,days_mask,start_minute,end_minute) SELECT gen_random_uuid(),id,1,127,480,600 FROM route_customers");
    const imported = await orderBoard(db.pool, plan.id);
    for (const shipment of imported.shipments) {
      await db.pool.query("UPDATE route_shipments SET vehicle_id=$2 WHERE id=$1", [shipment.id,
        members[shipment.orderName === "S4" ? 1 : 0].vehicleId]);
    }
    const board = await orderBoard(db.pool, plan.id);
    for (const member of members) {
      const snapshot = routePublicationSnapshot(board, board.vehicles.find(v => v.id === member.vehicleId)!, null, "execution-fixture");
      const serialized = JSON.stringify(snapshot);
      await db.pool.query(`INSERT INTO route_plan_publications(plan_id,vehicle_id,driver_id,source_plan_version,snapshot,snapshot_hash,published_by)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [plan.id, member.vehicleId, member.driverId, board.plan.version,
        serialized, createHash("sha256").update(serialized).digest("hex"), actor]);
    }
    const now = new Date("2026-09-24T17:00:00.000Z");
    const timezone = "America/Mexico_City";
    const start = async (member = members[0]) => {
      for (let i = 0; i < 5; i++) {
        const bytes = await sharp({ create: { width: 24, height: 24, channels: 3,
          background: { r: 30 + i * 30, g: 80, b: 90 } } }).jpeg().toBuffer();
        await uploadDriverUnitPhoto(db.pool, member.driverId, plan.id, bytes, "image/jpeg", timezone, photoRoot, now);
      }
      return startDriverRoute(db.pool, member.driverId, plan.id, 1, timezone, now, photoRoot);
    };
    return { db, actor, members, planId: plan.id, now, timezone, start, close };
  } catch (error) { await close(); throw error; }
}
