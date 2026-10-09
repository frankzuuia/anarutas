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
import { todayInTimezone } from "../../src/core/local-date";
import type { SourceShipment } from "../../src/core/orders-contract";

// Real isolated PostgreSQL, signatures, image files and start transaction. No HTTP/API mocks.
// The persisted publication is a fixture for execution, not a claim of a Google calculation.
export async function executionFixture(options: { groupFourthOrderWithFirst?: boolean; sourceFingerprint?: string; sourceShipments?: SourceShipment[]; sourceLineMetadata?: { uomId: number; saleLineId: number }; secondLinePerOrder?: boolean; orderCount?: number; partnerIds?: number[]; legacyUnloadingSnapshot?: boolean; now?: Date } = {}) {
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
    const now = options.now ?? new Date("2026-09-24T17:00:00.000Z");
    const timezone = "America/Mexico_City";
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
    const plan = await createPlan(db.pool, actor, { date: todayInTimezone(timezone, now), label: "Ejecución QA" });
    await selectPlanVehicles(db.pool, actor, plan.id, { vehicleIds: members.map(m => m.vehicleId), expectedVersion: plan.version });
    await persistImportPage(db.pool, actor, plan.id, {
      fingerprint: options.sourceFingerprint ?? createHash("sha256").update("execution-qa").digest("hex"),
      shipments: options.sourceShipments ?? Array.from({ length: options.orderCount ?? 4 }, (_, index) => index + 1).map(index => ({ pickingId: index, pickingName: `OUT/${index}`, orderId: index,
        orderName: `S${index}`, partnerId: options.partnerIds?.[index - 1] ?? (index === 4 ? 1 : index), customerName: `Cliente ${options.partnerIds?.[index - 1] ?? (index === 4 ? 1 : index)}`,
        address: `Calle ${options.partnerIds?.[index - 1] ?? (index === 4 ? 1 : index)}`, validatedAt: options.now?.toISOString() ?? "2026-09-24T12:00:00.000Z", promisedAt: null,
        backorderId: null, lines: [{ moveId: index, productId: index, name: `Producto ${index}`, quantity: 2, unit: "kg", ...options.sourceLineMetadata },
          ...(options.secondLinePerOrder ? [{ moveId: index + 10, productId: index + 10, name: `Producto ${index + 10}`, quantity: 3, unit: "kg" }] : [])] })),
      nextCursor: options.orderCount ?? 4, ceiling: options.orderCount ?? 4, hasMore: false, inspected: options.orderCount ?? 4, excluded: 0,
    });
    await db.pool.query("UPDATE route_customers SET latitude=20.64,longitude=-103.4,location_status='confirmed'");
    await db.pool.query("INSERT INTO route_customer_windows(id,customer_id,position,start_minute,end_minute) SELECT gen_random_uuid(),id,1,480,600 FROM route_customers");
    const imported = await orderBoard(db.pool, plan.id);
    for (const shipment of imported.shipments) {
      await db.pool.query("UPDATE route_shipments SET vehicle_id=$2 WHERE id=$1", [shipment.id,
        members[shipment.orderName === "S4" && !options.groupFourthOrderWithFirst && !options.partnerIds ? 1 : 0].vehicleId]);
    }
    const board = await orderBoard(db.pool, plan.id);
    for (const member of members) {
      const snapshot = routePublicationSnapshot(board, board.vehicles.find(v => v.id === member.vehicleId)!, null, "execution-fixture");
      if (options.groupFourthOrderWithFirst && member === members[0]) {
        const fourthIndex = snapshot.orders.findIndex(order => order.orderName === "S4");
        const firstIndex = snapshot.orders.findIndex(order => order.orderName === "S1");
        const [fourth] = snapshot.orders.splice(fourthIndex, 1);
        snapshot.orders.splice(firstIndex + 1, 0, fourth);
      }
      // Pre-v45 publications did not store unloading time. Preserve that real
      // wire shape explicitly when testing their existing manual fallback.
      const serialized = JSON.stringify(options.legacyUnloadingSnapshot ? {
        ...snapshot, orders: snapshot.orders.map(order => {
          const legacy: Partial<typeof order> = { ...order };
          delete legacy.unloadingMinutes;
          return legacy;
        }),
      } : snapshot);
      await db.pool.query(`INSERT INTO route_plan_publications(plan_id,vehicle_id,driver_id,source_plan_version,snapshot,snapshot_hash,published_by)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [plan.id, member.vehicleId, member.driverId, board.plan.version,
        serialized, createHash("sha256").update(serialized).digest("hex"), actor]);
    }
    const start = async (member = members[0], expectedRevision = 1) => {
      for (let i = 0; i < 5; i++) {
        const bytes = await sharp({ create: { width: 24, height: 24, channels: 3,
          background: { r: 30 + i * 30, g: 80, b: 90 } } }).jpeg().toBuffer();
        await uploadDriverUnitPhoto(db.pool, member.driverId, plan.id, bytes, "image/jpeg", timezone, photoRoot, now);
      }
      return startDriverRoute(db.pool, member.driverId, plan.id, expectedRevision, timezone, now, photoRoot);
    };
    return { db, actor, members, planId: plan.id, now, timezone, photoRoot, start, close };
  } catch (error) { await close(); throw error; }
}
