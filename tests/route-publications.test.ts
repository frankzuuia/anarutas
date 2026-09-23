import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { startPostgres } from "./helpers/postgres";
import { bootstrap } from "../src/core/auth";
import { migrate } from "../src/core/database";
import { assignDriver, createDriver, createVehicle, getVehicle } from "../src/core/fleet";
import { createPlan, deletePlan, editPlan } from "../src/core/plans";
import {
  moveShipment,
  orderBoard,
  persistImportPage,
  removeShipment,
  selectPlanVehicles,
} from "../src/core/orders";
import { routeFingerprint } from "../src/core/route-fingerprint";
import { getPlanOptimization } from "../src/core/route-optimization";
import {
  cancelStartedRoute,
  listRoutePublications,
  publishRoutes,
} from "../src/core/route-publications";
import {
  readDriverDashboard,
  listDriverPlans,
  readDriverPlan,
} from "../src/core/driver-mobile-route";
import { startDriverRoute } from "../src/core/route-start";
import {
  cleanExpiredUnitPhotos,
  listAdminUnitPhotos,
  listDriverUnitPhotos,
  readAdminUnitPhoto,
  readDriverUnitPhoto,
  sanitizeUnitPhoto,
  unitPhotoRoot,
  uploadDriverUnitPhoto,
} from "../src/core/unit-photos";

let db: Awaited<ReturnType<typeof startPostgres>>;
let actor: string;
let driverId: string;
let vehicleId: string;
let planId: string;
let planVersion: number;
let photoRoot: string;
const source = createHash("sha256").update("route-publication-qa").digest("hex");
const serviceTimezone = "America/Mexico_City";
const photoCaptureAt = new Date("2026-09-23T02:00:00.000Z");

beforeAll(async () => {
  photoRoot = await mkdtemp(join(tmpdir(), "ana-rutas-unit-photo-"));
  db = await startPostgres();
  actor = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "Publicación QA",
      login: "publication-qa",
      password: randomUUID(),
    })
  ).id;
  const driver = await createDriver(db.pool, actor, {
    id: randomUUID(),
    name: "Chofer real QA",
    phone: "3312345789",
    emergency_name: "",
    emergency_phone: "",
    blood_type: "",
    active: true,
  });
  driverId = driver.id;
  const vehicle = await createVehicle(db.pool, actor, {
    id: randomUUID(),
    name: "Unidad real QA",
    brand: "Ford",
    model: "Transit",
    plate: randomUUID().slice(0, 8),
    mileage: 0,
    fuel: "Diésel",
    available: true,
  });
  vehicleId = vehicle.id;
  await assignDriver(db.pool, actor, vehicleId, {
    driver_id: driverId,
    expectedVersion: vehicle.version,
  });
  const plan = await createPlan(db.pool, actor, {
    date: "2026-09-22",
    label: "Ruta publicada QA",
  });
  planId = plan.id;
  await selectPlanVehicles(db.pool, actor, planId, {
    vehicleIds: [vehicleId],
    expectedVersion: plan.version,
  });
  await persistImportPage(db.pool, actor, planId, {
    fingerprint: source,
    shipments: [
      {
        pickingId: 1,
        pickingName: "WH/OUT/1",
        orderId: 1,
        orderName: "S1",
        partnerId: 1,
        customerName: "Cliente real QA",
        address: "Calle 1, Guadalajara",
        validatedAt: "2026-09-22T12:00:00.000Z",
        promisedAt: null,
        backorderId: null,
        lines: [
          {
            moveId: 1,
            productId: 1,
            name: "Producto QA",
            quantity: 1,
            unit: "kg",
          },
        ],
      },
    ],
    nextCursor: 1,
    ceiling: 1,
    hasMore: false,
    inspected: 1,
    excluded: 0,
  });
  const board = await orderBoard(db.pool, planId);
  await db.pool.query(
    "UPDATE route_shipments SET vehicle_id=$2 WHERE id=$1",
    [board.shipments[0].id, vehicleId],
  );
  planVersion = board.plan.version;
});

afterAll(async () => {
  await db?.close();
  if (photoRoot) await rm(photoRoot, { recursive: true, force: true });
});

async function storeCalculatedRoute() {
  const board = await orderBoard(db.pool, planId);
  const shipment = board.shipments[0];
  const metrics = {
    travelDistanceMeters: 1000,
    travelDurationSeconds: 600,
    waitDurationSeconds: 0,
    totalDurationSeconds: 600,
    performedShipmentCount: 1,
  };
  await db.pool.query(
    `INSERT INTO route_optimization_runs
       (id,plan_id,base_plan_version,applied_plan_version,request_hash,input_fingerprint,metrics,routes,skipped,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'[]',$9)`,
    [
      randomUUID(),
      planId,
      board.plan.version - 1,
      board.plan.version,
      createHash("sha256").update(`publication-${board.plan.version}-${randomUUID()}`).digest("hex"),
      routeFingerprint(board, 0),
      JSON.stringify(metrics),
      JSON.stringify([
        {
          vehicleId,
          vehicleName: "Unidad real QA",
          encodedPolyline: null,
          segmentPolylines: [],
          departureAt: "2026-09-22T13:00:00.000Z",
          finishedAt: "2026-09-22T13:10:00.000Z",
          trafficMode: "static",
          metrics,
          stops: [
            {
              shipmentId: shipment.id,
              position: 1,
              eta: "2026-09-22T13:10:00.000Z",
              travelDistanceMeters: 1000,
              travelDurationSeconds: 600,
              waitDurationSeconds: 0,
            },
          ],
        },
      ]),
      actor,
    ],
  );
}

describe("route publication boundary / real PostgreSQL", () => {
  it("hides drafts and rejects publication without a current calculated route", async () => {
    expect(await listDriverPlans(db.pool, driverId)).toEqual([]);
    await expect(readDriverPlan(db.pool, driverId, planId, serviceTimezone)).rejects.toThrow(
      "NOT_FOUND",
    );
    await expect(
      publishRoutes(db.pool, actor, planId, {
        scope: "vehicle",
        vehicleId,
        expectedVersion: planVersion,
      }),
    ).rejects.toThrow("ROUTE_NOT_CURRENT");
    expect(await listRoutePublications(db.pool, planId)).toEqual([]);
  });

  it("rejects an unassigned, unavailable or inactive fleet driver", async () => {
    await storeCalculatedRoute();
    const publish = () => publishRoutes(db.pool, actor, planId, {
      scope: "vehicle", vehicleId, expectedVersion: planVersion,
    });
    try {
      await db.pool.query("UPDATE route_vehicles SET driver_id=NULL WHERE id=$1", [vehicleId]);
      await expect(publish()).rejects.toMatchObject({ code: "FLEET_UNAVAILABLE" });
      await db.pool.query("UPDATE route_vehicles SET driver_id=$2,available=false WHERE id=$1", [vehicleId, driverId]);
      await expect(publish()).rejects.toMatchObject({ code: "FLEET_UNAVAILABLE" });
      await db.pool.query("UPDATE route_vehicles SET available=true WHERE id=$1", [vehicleId]);
      await db.pool.query("UPDATE route_drivers SET active=false WHERE id=$1", [driverId]);
      await expect(publish()).rejects.toMatchObject({ code: "FLEET_UNAVAILABLE" });
      expect(await listRoutePublications(db.pool, planId)).toEqual([]);
    } finally {
      await db.pool.query("UPDATE route_drivers SET active=true WHERE id=$1", [driverId]);
      await db.pool.query("UPDATE route_vehicles SET driver_id=$2,available=true WHERE id=$1", [vehicleId, driverId]);
    }
  });

  it("rejects a route with the wrong vehicle or incomplete stops", async () => {
    const run = await db.pool.query(
      "SELECT id,routes FROM route_optimization_runs WHERE plan_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
      [planId],
    );
    const original = run.rows[0].routes as Array<Record<string, unknown>>;
    const publish = () => publishRoutes(db.pool, actor, planId, {
      scope: "vehicle", vehicleId, expectedVersion: planVersion,
    });
    const setRoutes = (routes: unknown[]) => db.pool.query(
      "UPDATE route_optimization_runs SET routes=$2::jsonb WHERE id=$1",
      [run.rows[0].id, JSON.stringify(routes)],
    );
    try {
      await setRoutes([]);
      await expect(publish()).rejects.toMatchObject({ code: "ROUTE_INCOMPLETE" });
      await setRoutes([{ ...original[0], vehicleId: randomUUID() }]);
      await expect(publish()).rejects.toMatchObject({ code: "ROUTE_INCOMPLETE" });
      await setRoutes([{ ...original[0], stops: [] }]);
      await expect(publish()).rejects.toMatchObject({ code: "ROUTE_INCOMPLETE" });
      const wrongStop = { ...(original[0].stops as Record<string, unknown>[])[0], shipmentId: randomUUID() };
      await setRoutes([{ ...original[0], stops: [wrongStop] }]);
      await expect(publish()).rejects.toMatchObject({ code: "ROUTE_INCOMPLETE" });
      expect(await listRoutePublications(db.pool, planId)).toEqual([]);
    } finally {
      await setRoutes(original);
    }
  });

  it("publishes once, isolates the driver and keeps a frozen snapshot after draft edits", async () => {
    await storeCalculatedRoute();
    const first = await publishRoutes(db.pool, actor, planId, {
      scope: "vehicle",
      vehicleId,
      expectedVersion: planVersion,
    });
    expect(first.changes).toMatchObject([
      { vehicleId, revision: 1, action: "published" },
    ]);
    await expect(cancelStartedRoute(db.pool, actor, planId, vehicleId, {
      expectedVersion: planVersion, expectedRevision: 1,
    })).rejects.toMatchObject({ code: "ROUTE_NOT_STARTED", status: 409 });
    expect(await listDriverPlans(db.pool, driverId)).toMatchObject([
      { id: planId, orders: 1, label: "Ruta publicada QA" },
    ]);
    expect(await readDriverPlan(db.pool, driverId, planId, serviceTimezone)).toMatchObject({
      plan: { label: "Ruta publicada QA" },
      orders: [{ orderName: "S1" }],
      publication: { revision: 1, startedAt: null },
    });
    await expect(
      readDriverPlan(db.pool, randomUUID(), planId, serviceTimezone),
    ).rejects.toThrow("NOT_FOUND");
    const repeated = await publishRoutes(db.pool, actor, planId, {
      scope: "all",
      expectedVersion: planVersion,
    });
    expect(repeated.changes).toEqual([]);
    expect(repeated.publications).toHaveLength(1);
    const runCount = Number((await db.pool.query(
      "SELECT count(*)::integer AS n FROM route_optimization_runs WHERE plan_id=$1", [planId],
    )).rows[0].n);

    const relief = await createDriver(db.pool, actor, {
      id: randomUUID(), name: "Relevo para publicación QA", phone: "3312345791",
      emergency_name: "", emergency_phone: "", blood_type: "", active: true,
    });
    let currentVehicle = await getVehicle(db.pool, vehicleId);
    await assignDriver(db.pool, actor, vehicleId, {
      driver_id: relief.id, expectedVersion: currentVehicle.version,
    });
    expect((await orderBoard(db.pool, planId)).vehicles[0]).toMatchObject({
      driver_id: driverId,
      fleet_driver_id: relief.id,
      fleet_driver_name: "Relevo para publicación QA",
    });
    await expect(readDriverPlan(db.pool, driverId, planId, serviceTimezone)).rejects.toThrow("NOT_FOUND");
    await expect(readDriverPlan(db.pool, relief.id, planId, serviceTimezone)).rejects.toThrow("NOT_FOUND");
    const transferred = await publishRoutes(db.pool, actor, planId, {
      scope: "vehicle", vehicleId, expectedVersion: planVersion,
    });
    expect(transferred.changes).toMatchObject([{ vehicleId, revision: 2 }]);
    expect((await orderBoard(db.pool, planId)).vehicles[0].driver_id).toBe(relief.id);
    expect((await readDriverPlan(db.pool, relief.id, planId, serviceTimezone)).orders).toHaveLength(1);
    currentVehicle = await getVehicle(db.pool, vehicleId);
    await assignDriver(db.pool, actor, vehicleId, {
      driver_id: driverId, expectedVersion: currentVehicle.version,
    });
    const restored = await publishRoutes(db.pool, actor, planId, {
      scope: "vehicle", vehicleId, expectedVersion: planVersion,
    });
    expect(restored.changes).toMatchObject([{ vehicleId, revision: 3 }]);
    await expect(readDriverPlan(db.pool, relief.id, planId, serviceTimezone)).rejects.toThrow("NOT_FOUND");
    expect((await getPlanOptimization(db.pool, planId))?.current).toBe(true);
    expect(Number((await db.pool.query(
      "SELECT count(*)::integer AS n FROM route_optimization_runs WHERE plan_id=$1", [planId],
    )).rows[0].n)).toBe(runCount);

    const edited = await editPlan(db.pool, actor, planId, {
      label: "Borrador editado QA",
      expectedVersion: planVersion,
    });
    expect(await readDriverPlan(db.pool, driverId, planId, serviceTimezone)).toMatchObject({
      plan: { label: "Ruta publicada QA" },
    });
    await expect(
      publishRoutes(db.pool, actor, planId, {
        scope: "vehicle",
        vehicleId,
        expectedVersion: edited.version,
      }),
    ).rejects.toThrow("ROUTE_NOT_CURRENT");
    expect((await listRoutePublications(db.pool, planId))[0].revision).toBe(3);
  });

  it("requires five distinct private WebP photos, limits eight, and starts idempotently", async () => {
    const now = photoCaptureAt;
    await expect(startDriverRoute(db.pool, driverId, planId, 2, serviceTimezone, now, photoRoot))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    await expect(startDriverRoute(db.pool, driverId, planId, 3, serviceTimezone, new Date("2026-09-21T18:00:00.000Z"), photoRoot))
      .rejects.toMatchObject({ code: "ROUTE_DATE_MISMATCH", status: 409 });
    await expect(unitPhotoRoot("relative-photo-folder"))
      .rejects.toMatchObject({ code: "UNIT_PHOTO_STORAGE_UNAVAILABLE", status: 503 });
    await expect(
      startDriverRoute(db.pool, driverId, planId, 3, serviceTimezone, now, photoRoot),
    ).rejects.toMatchObject({ code: "UNIT_PHOTOS_REQUIRED", status: 409 });
    await expect(
      uploadDriverUnitPhoto(db.pool, driverId, planId, Buffer.from("not an image"), "image/jpeg", serviceTimezone, photoRoot, photoCaptureAt),
    ).rejects.toMatchObject({ code: "UNIT_PHOTO_INVALID", status: 415 });
    const wrongDayImage = await sharp({
      create: { width: 24, height: 24, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).jpeg().toBuffer();
    await expect(uploadDriverUnitPhoto(db.pool, driverId, planId, wrongDayImage,
      "image/jpeg", serviceTimezone, photoRoot, new Date("2026-09-21T18:00:00.000Z")))
      .rejects.toMatchObject({ code: "ROUTE_DATE_MISMATCH", status: 409 });
    let first: Buffer | undefined;
    let firstId = "";
    for (let index = 0; index < 8; index++) {
      const bytes = await sharp({
        create: { width: 50, height: 50, channels: 3, background: { r: index * 20, g: 60, b: 90 } },
      }).jpeg().toBuffer();
      if (!index) first = bytes;
      const saved = await uploadDriverUnitPhoto(db.pool, driverId, planId, bytes, "image/jpeg", serviceTimezone, photoRoot, photoCaptureAt);
      expect(saved.duplicate).toBe(false);
      if (!index) firstId = saved.id;
      if (index === 4)
        expect((await listDriverUnitPhotos(db.pool, driverId, planId, serviceTimezone))).toHaveLength(5);
    }
    await expect(sanitizeUnitPhoto(first!, "image/png"))
      .rejects.toMatchObject({ code: "UNIT_PHOTO_INVALID", status: 415 });
    await expect(sanitizeUnitPhoto(Buffer.alloc(8 * 1024 * 1024 + 1), "image/jpeg"))
      .rejects.toMatchObject({ code: "UNIT_PHOTO_TOO_LARGE", status: 413 });
    const captureDate = "2026-09-22";
    const adminPhotos = await listAdminUnitPhotos(db.pool, actor, vehicleId, captureDate, serviceTimezone);
    expect(adminPhotos).toHaveLength(8);
    expect(adminPhotos[0]).toMatchObject({
      planId, vehicleId, planLabel: "Ruta publicada QA", serviceDate: "2026-09-22",
    });
    expect(await listAdminUnitPhotos(db.pool, actor, vehicleId, "2000-01-01", serviceTimezone)).toEqual([]);
    await expect(listAdminUnitPhotos(db.pool, actor, vehicleId, "2026-99-99", serviceTimezone))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await readAdminUnitPhoto(db.pool, actor, firstId, photoRoot)).subarray(0, 4).toString("hex"))
      .toBe("52494646");
    const duplicate = await uploadDriverUnitPhoto(db.pool, driverId, planId, first!, "image/jpeg", serviceTimezone, photoRoot, photoCaptureAt);
    expect(duplicate).toMatchObject({ id: firstId, duplicate: true });
    const otherPlan = await createPlan(db.pool, actor, { date: "2026-10-01", label: "Otra ruta para probar foto repetida" });
    expect(otherPlan.id).not.toBe(planId);
    await selectPlanVehicles(db.pool, actor, otherPlan.id, {
      vehicleIds: [vehicleId], expectedVersion: otherPlan.version,
    });
    await db.pool.query("UPDATE route_unit_photos SET plan_id=$2 WHERE id=$1", [firstId, otherPlan.id]);
    expect((await db.pool.query("SELECT plan_id FROM route_unit_photos WHERE id=$1", [firstId])).rows[0].plan_id)
      .toBe(otherPlan.id);
    const legacyPhotoId = randomUUID();
    try {
      await db.pool.query(
        `INSERT INTO route_unit_photos(id,plan_id,vehicle_id,driver_id,storage_key,content_hash,bytes,created_at,expires_at)
         SELECT $1,$2,vehicle_id,driver_id,$3,content_hash,bytes,created_at,expires_at
           FROM route_unit_photos WHERE id=$4`,
        [legacyPhotoId, planId, `${legacyPhotoId}.webp`, firstId],
      );
      expect((await db.pool.query(
        `SELECT count(*)::integer AS n FROM route_unit_photos
          WHERE vehicle_id=$1 AND content_hash=(SELECT content_hash FROM route_unit_photos WHERE id=$2)`,
        [vehicleId, firstId],
      )).rows[0].n).toBe(2);
      await expect(uploadDriverUnitPhoto(db.pool, driverId, planId, first!, "image/jpeg", serviceTimezone, photoRoot, photoCaptureAt))
        .rejects.toMatchObject({ code: "UNIT_PHOTO_REUSED", status: 409 });
    } finally {
      await db.pool.query("DELETE FROM route_unit_photos WHERE id=$1", [legacyPhotoId]);
      await db.pool.query("UPDATE route_unit_photos SET plan_id=$2 WHERE id=$1", [firstId, planId]);
    }
    expect((await listDriverUnitPhotos(db.pool, driverId, planId, serviceTimezone))).toHaveLength(8);
    expect((await readDriverUnitPhoto(db.pool, driverId, firstId, photoRoot)).subarray(0, 4).toString("hex"))
      .toBe("52494646");
    await expect(readDriverUnitPhoto(db.pool, randomUUID(), firstId, photoRoot))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await db.pool.query(
      `UPDATE route_unit_photos SET created_at=$2::timestamptz WHERE id IN (
         SELECT id FROM route_unit_photos WHERE plan_id=$1 ORDER BY id LIMIT 4
       )`,
      [planId, "2026-09-21T18:00:00.000Z"],
    );
    expect((await readDriverPlan(db.pool, driverId, planId, serviceTimezone)).publication.photoCount).toBe(4);
    expect(await listDriverUnitPhotos(db.pool, driverId, planId, serviceTimezone)).toHaveLength(4);
    await expect(startDriverRoute(db.pool, driverId, planId, 3, serviceTimezone, now, photoRoot))
      .rejects.toMatchObject({ code: "UNIT_PHOTOS_REQUIRED", status: 409 });
    await db.pool.query("UPDATE route_unit_photos SET created_at=$2::timestamptz WHERE plan_id=$1",
      [planId, photoCaptureAt.toISOString()]);
    const replacement = await createDriver(db.pool, actor, {
      id: randomUUID(), name: "Relevo QA", phone: "3312345790",
      emergency_name: "", emergency_phone: "", blood_type: "", active: true,
    });
    try {
      await db.pool.query("UPDATE route_plan_publications SET driver_id=$2 WHERE plan_id=$1", [planId, replacement.id]);
      await db.pool.query("UPDATE route_plan_vehicles SET driver_id=$2 WHERE plan_id=$1", [planId, replacement.id]);
      await db.pool.query("UPDATE route_vehicles SET driver_id=$2 WHERE id=$1", [vehicleId, replacement.id]);
      expect((await readDriverPlan(db.pool, replacement.id, planId, serviceTimezone)).publication.photoCount).toBe(0);
      expect(await listDriverUnitPhotos(db.pool, replacement.id, planId, serviceTimezone)).toEqual([]);
      await expect(readDriverUnitPhoto(db.pool, replacement.id, firstId, photoRoot))
        .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
      await expect(startDriverRoute(db.pool, replacement.id, planId, 3, serviceTimezone, now, photoRoot))
        .rejects.toMatchObject({ code: "UNIT_PHOTOS_REQUIRED", status: 409 });
    } finally {
      await db.pool.query("UPDATE route_vehicles SET driver_id=$2 WHERE id=$1", [vehicleId, driverId]);
      await db.pool.query("UPDATE route_plan_vehicles SET driver_id=$2 WHERE plan_id=$1", [planId, driverId]);
      await db.pool.query("UPDATE route_plan_publications SET driver_id=$2 WHERE plan_id=$1", [planId, driverId]);
    }
    const ninth = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 250, g: 5, b: 5 } },
    }).jpeg().toBuffer();
    await expect(uploadDriverUnitPhoto(db.pool, driverId, planId, ninth, "image/jpeg", serviceTimezone, photoRoot, photoCaptureAt))
      .rejects.toMatchObject({ code: "UNIT_PHOTO_LIMIT", status: 409 });
    const beforeRace = await getVehicle(db.pool, vehicleId);
    const [startRace, assignmentRace] = await Promise.allSettled([
      startDriverRoute(db.pool, driverId, planId, 3, serviceTimezone, now, photoRoot),
      assignDriver(db.pool, actor, vehicleId, {
        driver_id: null, expectedVersion: beforeRace.version,
      }),
    ]);
    expect(assignmentRace.status).toBe("fulfilled");
    let started;
    if (startRace.status === "fulfilled") {
      started = startRace.value;
    } else {
      expect(startRace.reason).toMatchObject({ code: "NOT_FOUND", status: 404 });
    }
    const unassigned = await getVehicle(db.pool, vehicleId);
    expect(unassigned.driver_id).toBeNull();
    expect(await readDriverPlan(db.pool, driverId, planId, serviceTimezone).then(() => true, () => false))
      .toBe(startRace.status === "fulfilled");
    await assignDriver(db.pool, actor, vehicleId, {
      driver_id: driverId, expectedVersion: unassigned.version,
    });
    if (!started) started = await startDriverRoute(db.pool, driverId, planId, 3, serviceTimezone, now, photoRoot);
    expect(started.alreadyStarted).toBe(false);
    expect((await startDriverRoute(db.pool, driverId, planId, 3, serviceTimezone, now, photoRoot)).alreadyStarted)
      .toBe(true);
    expect((await startDriverRoute(db.pool, driverId, planId, 3, serviceTimezone, now, "/missing-unit-photo-volume")).alreadyStarted)
      .toBe(true);
    await expect(startDriverRoute(db.pool, randomUUID(), planId, 3, serviceTimezone, now, "/missing-unit-photo-volume"))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect((await readDriverPlan(db.pool, driverId, planId, serviceTimezone)).publication)
      .toMatchObject({ photoCount: 8 });
    await expect(uploadDriverUnitPhoto(db.pool, driverId, planId, ninth, "image/jpeg", serviceTimezone, photoRoot, photoCaptureAt))
      .rejects.toMatchObject({ code: "ROUTE_ALREADY_STARTED", status: 409 });
  });

  it("enforces a started lane in PostgreSQL, not just in the UI", async () => {
    const board = await orderBoard(db.pool, planId);
    const shipmentId = board.shipments[0].id;
    await expect(
      moveShipment(db.pool, actor, planId, {
        shipmentId,
        vehicleId: null,
        beforeId: null,
        expectedVersion: board.plan.version,
      }),
    ).rejects.toMatchObject({ code: "ROUTE_ALREADY_STARTED", status: 409 });
    await expect(
      removeShipment(db.pool, actor, planId, {
        shipmentId,
        expectedVersion: board.plan.version,
      }),
    ).rejects.toMatchObject({ code: "ROUTE_ALREADY_STARTED", status: 409 });
    await expect(
      deletePlan(db.pool, actor, planId, {
        expectedVersion: board.plan.version,
      }),
    ).rejects.toMatchObject({ code: "ROUTE_ALREADY_STARTED", status: 409 });
    await expect(
      publishRoutes(db.pool, actor, planId, {
        scope: "vehicle",
        vehicleId,
        expectedVersion: board.plan.version,
      }),
    ).rejects.toMatchObject({ code: "ROUTE_ALREADY_STARTED", status: 409 });
    await expect(
      db.pool.query("UPDATE route_vehicles SET available=false WHERE id=$1", [
        vehicleId,
      ]),
    ).rejects.toMatchObject({ code: "PZR01" });
    expect((await orderBoard(db.pool, planId)).shipments).toHaveLength(1);
  });

  it("keeps a started route with its original driver while the fleet assignment changes for future plans", async () => {
    const relief = await createDriver(db.pool, actor, {
      id: randomUUID(), name: "Chofer futuro QA", phone: "3312345792",
      emergency_name: "", emergency_phone: "", blood_type: "", active: true,
    });
    let vehicle = await getVehicle(db.pool, vehicleId);
    await assignDriver(db.pool, actor, vehicleId, {
      driver_id: null, expectedVersion: vehicle.version,
    });
    vehicle = await getVehicle(db.pool, vehicleId);
    await assignDriver(db.pool, actor, vehicleId, {
      driver_id: relief.id, expectedVersion: vehicle.version,
    });
    expect((await readDriverPlan(db.pool, driverId, planId, serviceTimezone)).publication.startedAt).toBeTruthy();
    expect((await listDriverPlans(db.pool, driverId)).some((row) => row.id === planId)).toBe(true);
    expect((await startDriverRoute(db.pool, driverId, planId, 3, serviceTimezone, new Date("2026-09-23T03:00:00.000Z"), photoRoot)).alreadyStarted).toBe(true);
    expect((await readDriverUnitPhoto(db.pool, driverId,
      (await listDriverUnitPhotos(db.pool, driverId, planId, serviceTimezone))[0].id, photoRoot)).length).toBeGreaterThan(0);
    await expect(readDriverPlan(db.pool, relief.id, planId, serviceTimezone)).rejects.toThrow("NOT_FOUND");
    await expect(startDriverRoute(db.pool, relief.id, planId, 3, serviceTimezone, new Date("2026-09-23T03:00:00.000Z"), photoRoot)).rejects.toThrow("NOT_FOUND");
    const tomorrow = await createPlan(db.pool, actor, {
      date: "2026-09-23", label: "Unidad con relevo",
    });
    await selectPlanVehicles(db.pool, actor, tomorrow.id, {
      vehicleIds: [vehicleId], expectedVersion: tomorrow.version,
    });
    const nextBoard = await orderBoard(db.pool, tomorrow.id);
    expect(nextBoard.vehicles[0].driver_id).toBe(relief.id);
  });

  it("lets an admin revoke a started route without deleting photos, then edit and republish safely", async () => {
    const board = await orderBoard(db.pool, planId);
    const started = (await listRoutePublications(db.pool, planId))[0];
    const photo = (await listDriverUnitPhotos(db.pool, driverId, planId, serviceTimezone))[0];
    expect(started.started_at).toBeTruthy();
    expect(photo).toBeTruthy();
    const request = { expectedVersion: board.plan.version, expectedRevision: started.revision };
    await expect(cancelStartedRoute(db.pool, actor, randomUUID(), vehicleId, request))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(cancelStartedRoute(db.pool, randomUUID(), planId, vehicleId, request))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    await expect(cancelStartedRoute(db.pool, actor, planId, vehicleId, { ...request, expectedVersion: board.plan.version - 1 }))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    await expect(cancelStartedRoute(db.pool, actor, planId, randomUUID(), request))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(cancelStartedRoute(db.pool, actor, planId, vehicleId, { ...request, expectedRevision: started.revision - 1 }))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    await expect(db.pool.query(
      "UPDATE route_plan_publications SET started_at=NULL,started_driver_id=NULL,revoked_at=now(),revision=revision+1 WHERE plan_id=$1 AND vehicle_id=$2",
      [planId, vehicleId],
    )).rejects.toMatchObject({ code: "PZR01" });
    expect((await listRoutePublications(db.pool, planId))[0].started_at).toBeTruthy();

    const competing = await Promise.allSettled([
      cancelStartedRoute(db.pool, actor, planId, vehicleId, request),
      cancelStartedRoute(db.pool, actor, planId, vehicleId, request),
    ]);
    expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(competing.filter((result) => result.status === "rejected")).toHaveLength(1);
    const cancelled = competing.find((result) => result.status === "fulfilled")!.value;
    expect(cancelled.publications).toEqual([]);
    expect(await listDriverPlans(db.pool, driverId)).toEqual([]);
    expect((await readDriverDashboard(db.pool, driverId, serviceTimezone, photoCaptureAt)).today).toBeNull();
    await expect(readDriverPlan(db.pool, driverId, planId, serviceTimezone))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(startDriverRoute(db.pool, driverId, planId, started.revision, serviceTimezone, photoCaptureAt, photoRoot))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(listDriverUnitPhotos(db.pool, driverId, planId, serviceTimezone))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(readDriverUnitPhoto(db.pool, driverId, photo.id, photoRoot))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect((await readAdminUnitPhoto(db.pool, actor, photo.id, photoRoot)).length).toBeGreaterThan(0);
    expect((await listAdminUnitPhotos(db.pool, actor, vehicleId, "2026-09-22", serviceTimezone)).length)
      .toBeGreaterThan(0);
    await expect(cancelStartedRoute(db.pool, actor, planId, vehicleId, request))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    const audit = await db.pool.query(
      "SELECT details FROM route_audit WHERE action='route.start.cancelled' AND entity_id=$1 ORDER BY id DESC LIMIT 1",
      [planId],
    );
    expect(audit.rows[0].details).toMatchObject({ vehicleId, previousRevision: started.revision });
    expect(Number((await db.pool.query(
      "SELECT count(*)::integer AS n FROM route_audit WHERE action='route.start.cancelled' AND entity_id=$1",
      [planId],
    )).rows[0].n)).toBe(1);

    await moveShipment(db.pool, actor, planId, {
      shipmentId: board.shipments[0].id, vehicleId: null, beforeId: null,
      expectedVersion: board.plan.version,
    });
    const edited = await orderBoard(db.pool, planId);
    expect(edited.shipments[0].vehicle_id).toBeNull();
    await moveShipment(db.pool, actor, planId, {
      shipmentId: board.shipments[0].id, vehicleId, beforeId: null,
      expectedVersion: edited.plan.version,
    });
    let fleet = await getVehicle(db.pool, vehicleId);
    await assignDriver(db.pool, actor, vehicleId, { driver_id: null, expectedVersion: fleet.version });
    fleet = await getVehicle(db.pool, vehicleId);
    await assignDriver(db.pool, actor, vehicleId, { driver_id: driverId, expectedVersion: fleet.version });
    await storeCalculatedRoute();
    const republished = await publishRoutes(db.pool, actor, planId, {
      scope: "vehicle", vehicleId, expectedVersion: (await orderBoard(db.pool, planId)).plan.version,
    });
    expect(republished.changes).toMatchObject([
      { vehicleId, revision: started.revision + 2, action: "published" },
    ]);
    await expect(startDriverRoute(db.pool, driverId, planId, started.revision, serviceTimezone, photoCaptureAt, photoRoot))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    expect((await readDriverPlan(db.pool, driverId, planId, serviceTimezone)).publication.revision)
      .toBe(started.revision + 2);
    await startDriverRoute(db.pool, driverId, planId, started.revision + 2, serviceTimezone, photoCaptureAt, photoRoot);
  });

  it("cleans expired photos and their private files", async () => {
    await db.pool.query("UPDATE route_unit_photos SET expires_at=now()-interval '1 second' WHERE plan_id=$1", [planId]);
    expect(await cleanExpiredUnitPhotos(db.pool, photoRoot)).toBe(8);
    expect(await listDriverUnitPhotos(db.pool, driverId, planId, serviceTimezone)).toEqual([]);
    await expect(readAdminUnitPhoto(db.pool, actor, randomUUID(), photoRoot))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("upgrades an existing v14 database so a started unit can be reassigned for future plans", async () => {
    const assigned = await getVehicle(db.pool, vehicleId);
    await assignDriver(db.pool, actor, vehicleId, {
      driver_id: null, expectedVersion: assigned.version,
    });
    await db.pool.query(`
      CREATE OR REPLACE FUNCTION guard_started_fleet_vehicle()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF OLD.driver_id IS DISTINCT FROM NEW.driver_id AND EXISTS (
          SELECT 1 FROM route_plan_publications p
           WHERE p.vehicle_id=OLD.id AND p.started_at IS NOT NULL
        ) THEN
          PERFORM reject_started_route_change();
        END IF;
        RETURN NEW;
      END $$;
      DROP TRIGGER guard_started_fleet_vehicle_change ON route_vehicles;
      CREATE TRIGGER guard_started_fleet_vehicle_change
        BEFORE UPDATE OF available,driver_id ON route_vehicles
        FOR EACH ROW EXECUTE FUNCTION guard_started_fleet_vehicle();
      UPDATE rutas_installation SET schema_version=14 WHERE singleton=true;
    `);
    let vehicle = await getVehicle(db.pool, vehicleId);
    await expect(assignDriver(db.pool, actor, vehicleId, {
      driver_id: driverId, expectedVersion: vehicle.version,
    })).rejects.toMatchObject({ code: "ROUTE_ALREADY_STARTED" });
    await migrate(db.pool, db.config.instanceId);
    expect((await db.pool.query("SELECT schema_version FROM rutas_installation")).rows[0].schema_version).toBe(17);
    vehicle = await getVehicle(db.pool, vehicleId);
    await assignDriver(db.pool, actor, vehicleId, {
      driver_id: driverId, expectedVersion: vehicle.version,
    });
    expect((await readDriverPlan(db.pool, driverId, planId, serviceTimezone)).publication.startedAt).toBeTruthy();
  });
});
