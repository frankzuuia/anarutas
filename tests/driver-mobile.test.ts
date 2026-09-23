import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { startPostgres } from "./helpers/postgres";
import { bootstrap } from "../src/core/auth";
import {
  assignDriver,
  createDriver,
  createVehicle,
  editDriver,
} from "../src/core/fleet";
import { createPlan } from "../src/core/plans";
import { publishRoutes } from "../src/core/route-publications";
import { routeFingerprint } from "../src/core/route-fingerprint";
import {
  orderBoard,
  persistImportPage,
  selectPlanVehicles,
} from "../src/core/orders";
import {
  authenticateMobile,
  configureMobileAccess,
  createMobileChallenge,
  enrollMobileDevice,
  loginMobile,
  logoutMobile,
  mobileAccessStatus,
  mobileChallengeMessage,
  mobilePhoneKey,
  mobilePin,
  revokeMobileAccess,
} from "../src/core/driver-mobile-auth";
import {
  mobileEventStream,
  driverPublicationFingerprint,
} from "../src/core/driver-mobile-events";
import { tokenHash } from "../src/core/crypto";
import { audit, transaction } from "../src/core/database";
import {
  listDriverPlans,
  readDriverDashboard,
  readDriverPlan,
} from "../src/core/driver-mobile-route";
import type { SourceShipment } from "../src/core/orders-contract";

let db: Awaited<ReturnType<typeof startPostgres>>;
let admin: string;
let driverA: Awaited<ReturnType<typeof createDriver>>;
let driverB: Awaited<ReturnType<typeof createDriver>>;
let planId: string;
let originalPepper: string | undefined;

const source = createHash("sha256").update("mobile-qa-source").digest("hex");
function driver(name: string, phone: string) {
  return {
    id: randomUUID(),
    name,
    phone,
    emergency_name: "",
    emergency_phone: "",
    blood_type: "",
    active: true,
  };
}
function vehicle(name: string) {
  return {
    id: randomUUID(),
    name,
    brand: "QA",
    model: "QA",
    plate: randomUUID().slice(0, 8),
    mileage: 1,
    fuel: "Gasolina",
    available: true,
  };
}
function shipment(index: number): SourceShipment {
  return {
    pickingId: index,
    pickingName: `WH/OUT/${index}`,
    orderId: index,
    orderName: `S${index}`,
    partnerId: index,
    customerName: `Cliente ${index}`,
    address: `Calle ${index}, Guadalajara`,
    validatedAt: "2026-09-20T12:00:00.000Z",
    promisedAt: null,
    backorderId: null,
    lines: [
      {
        moveId: index * 10,
        productId: index,
        name: `Producto ${index}`,
        quantity: 2,
        unit: "kg",
      },
    ],
  };
}
function deviceKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey,
  };
}

beforeAll(async () => {
  originalPepper = process.env.RUTAS_DRIVER_PIN_PEPPER;
  process.env.RUTAS_DRIVER_PIN_PEPPER = randomBytes(48).toString("hex");
  db = await startPostgres();
  admin = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "Mobile QA",
      login: "mobile-qa",
      password: randomUUID(),
    })
  ).id;
  driverA = await createDriver(
    db.pool,
    admin,
    driver("Chofer A", "33 1234 5678"),
  );
  driverB = await createDriver(
    db.pool,
    admin,
    driver("Chofer B", "33 1234 5679"),
  );
  const vehicleA = await createVehicle(db.pool, admin, vehicle("Unidad A"));
  const vehicleB = await createVehicle(db.pool, admin, vehicle("Unidad B"));
  await assignDriver(db.pool, admin, vehicleA.id, {
    driver_id: driverA.id,
    expectedVersion: vehicleA.version,
  });
  await assignDriver(db.pool, admin, vehicleB.id, {
    driver_id: driverB.id,
    expectedVersion: vehicleB.version,
  });
  const plan = await createPlan(db.pool, admin, {
    date: "2026-09-21",
    label: "Móvil QA",
  });
  planId = plan.id;
  await selectPlanVehicles(db.pool, admin, planId, {
    vehicleIds: [vehicleA.id, vehicleB.id],
    expectedVersion: plan.version,
  });
  await persistImportPage(db.pool, admin, planId, {
    fingerprint: source,
    shipments: [shipment(501), shipment(502)],
    nextCursor: 2,
    ceiling: 2,
    hasMore: false,
    inspected: 2,
    excluded: 0,
  });
  const board = await orderBoard(db.pool, planId);
  await db.pool.query("UPDATE route_shipments SET vehicle_id=$2 WHERE id=$1", [
    board.shipments[0].id,
    vehicleA.id,
  ]);
  await db.pool.query("UPDATE route_shipments SET vehicle_id=$2 WHERE id=$1", [
    board.shipments[1].id,
    vehicleB.id,
  ]);
  const assigned = await orderBoard(db.pool, planId);
  const fingerprint = routeFingerprint(assigned, 0);
  const routes = assigned.vehicles.map((unit) => {
    const own = assigned.shipments.filter(
      (item) => item.vehicle_id === unit.id,
    );
    return {
      vehicleId: unit.id,
      vehicleName: unit.name,
      encodedPolyline: null,
      segmentPolylines: [],
      departureAt: "2026-09-21T13:00:00.000Z",
      finishedAt: "2026-09-21T14:00:00.000Z",
      trafficMode: "static",
      metrics: {
        travelDistanceMeters: 1000,
        travelDurationSeconds: 600,
        waitDurationSeconds: 0,
        totalDurationSeconds: 600,
        performedShipmentCount: own.length,
      },
      stops: own.map((item, index) => ({
        shipmentId: item.id,
        position: index + 1,
        eta: "2026-09-21T13:30:00.000Z",
        travelDistanceMeters: 1000,
        travelDurationSeconds: 600,
        waitDurationSeconds: 0,
      })),
    };
  });
  await db.pool.query(
    `INSERT INTO route_optimization_runs
       (id,plan_id,base_plan_version,applied_plan_version,request_hash,input_fingerprint,metrics,routes,skipped,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'[]',$9)`,
    [
      randomUUID(),
      planId,
      assigned.plan.version - 1,
      assigned.plan.version,
      createHash("sha256").update("mobile-published-route").digest("hex"),
      fingerprint,
      JSON.stringify({
        travelDistanceMeters: 2000,
        travelDurationSeconds: 1200,
        waitDurationSeconds: 0,
        totalDurationSeconds: 1200,
        performedShipmentCount: 2,
      }),
      JSON.stringify(routes),
      admin,
    ],
  );
  await publishRoutes(db.pool, admin, planId, {
    scope: "all",
    expectedVersion: assigned.plan.version,
  });
});

afterAll(async () => {
  await db?.close();
  if (originalPepper === undefined) delete process.env.RUTAS_DRIVER_PIN_PEPPER;
  else process.env.RUTAS_DRIVER_PIN_PEPPER = originalPepper;
});

async function mobileEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await reader.read();
  return result.done ? "closed" : new TextDecoder().decode(result.value);
}

describe("driver route events / real PostgreSQL authorization", () => {
  it("signals only the driver's committed publication and recovers without exposing another route", async () => {
    const tokens = [
      randomBytes(32).toString("hex"),
      randomBytes(32).toString("hex"),
    ];
    const drivers = [driverA, driverB];
    const deviceIds = [randomUUID(), randomUUID()];
    for (const [index, current] of drivers.entries()) {
      await db.pool.query(
        `INSERT INTO route_driver_mobile_access(driver_id,login_phone,pin_hash,updated_by)
         VALUES($1,$2,$3,$4)`,
        [
          current.id,
          mobilePhoneKey(current.phone),
          "integration-fixture",
          admin,
        ],
      );
      await db.pool.query(
        `INSERT INTO route_driver_mobile_devices(id,driver_id,public_key,public_key_hash)
         VALUES($1,$2,$3,$4)`,
        [
          deviceIds[index],
          current.id,
          "integration-fixture",
          randomBytes(32).toString("hex"),
        ],
      );
      await db.pool.query(
        `INSERT INTO route_driver_mobile_sessions(token_hash,driver_id,device_id,expires_at)
         VALUES($1,$2,$3,now()+interval '1 hour')`,
        [tokenHash(tokens[index]), current.id, deviceIds[index]],
      );
    }
    const beforeA = await driverPublicationFingerprint(db.pool, driverA.id);
    const beforeB = await driverPublicationFingerprint(db.pool, driverB.id);
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const readerA = mobileEventStream(
      db.pool,
      `Bearer ${tokens[0]}`,
      driverA.id,
      controllerA.signal,
      60,
    ).getReader();
    const readerB = mobileEventStream(
      db.pool,
      `Bearer ${tokens[1]}`,
      driverB.id,
      controllerB.signal,
      60,
    ).getReader();
    try {
      expect(await mobileEvent(readerA)).toBe("event: reset\ndata: {}\n\n");
      expect(await mobileEvent(readerB)).toBe("event: reset\ndata: {}\n\n");
      const pendingA = mobileEvent(readerA);
      await expect(
        transaction(db.pool, async (sql) => {
          await sql.query(
            "UPDATE route_plan_publications SET revision=revision+1 WHERE plan_id=$1 AND driver_id=$2",
            [planId, driverA.id],
          );
          throw new Error("rollback route event");
        }),
      ).rejects.toThrow("rollback route event");
      expect(
        await Promise.race([
          pendingA.then(() => "unexpected"),
          new Promise((resolve) => setTimeout(() => resolve("quiet"), 300)),
        ]),
      ).toBe("quiet");
      const pendingB = mobileEvent(readerB);
      await db.pool.query(
        "UPDATE route_plan_publications SET revision=revision+1 WHERE plan_id=$1 AND driver_id=$2",
        [planId, driverA.id],
      );
      expect(await pendingA).toBe("event: change\ndata: {}\n\n");
      expect(await driverPublicationFingerprint(db.pool, driverA.id)).not.toBe(
        beforeA,
      );
      expect(await driverPublicationFingerprint(db.pool, driverB.id)).toBe(
        beforeB,
      );
      controllerB.abort();
      expect(await pendingB).toBe("closed");
      const pendingUnrelated = mobileEvent(readerA);
      await audit(db.pool, admin, "qa.unrelated.mobile.events");
      expect(
        await Promise.race([
          pendingUnrelated.then(() => "unexpected"),
          new Promise((resolve) => setTimeout(() => resolve("quiet"), 300)),
        ]),
      ).toBe("quiet");
      await db.pool.query(
        "UPDATE route_driver_mobile_sessions SET revoked_at=now() WHERE token_hash=$1",
        [tokenHash(tokens[0])],
      );
      await db.pool.query(
        "UPDATE route_plan_publications SET revision=revision+1 WHERE plan_id=$1 AND driver_id=$2",
        [planId, driverA.id],
      );
      expect(await pendingUnrelated).toBe(
        "event: session-expired\ndata: {}\n\n",
      );
      const heartbeatAbort = new AbortController();
      const heartbeatReader = mobileEventStream(
        db.pool,
        `Bearer ${tokens[1]}`,
        driverB.id,
        heartbeatAbort.signal,
        1,
      ).getReader();
      expect(await mobileEvent(heartbeatReader)).toBe("event: reset\ndata: {}\n\n");
      expect(await mobileEvent(heartbeatReader)).toBe("event: heartbeat\ndata: {}\n\n");
      await db.pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query='LISTEN ana_rutas_panel'");
      expect(await mobileEvent(heartbeatReader)).toBe("closed");
      heartbeatAbort.abort();
      await heartbeatReader.cancel();

      const slowAbort = new AbortController();
      const slowReader = mobileEventStream(
        db.pool,
        `Bearer ${tokens[1]}`,
        driverB.id,
        slowAbort.signal,
        60,
      ).getReader();
      await expect.poll(async () => Number((await db.pool.query(
        "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE query='LISTEN ana_rutas_panel'",
      )).rows[0].n)).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await db.pool.query(
        "UPDATE route_plan_publications SET revision=revision+1 WHERE plan_id=$1 AND driver_id=$2",
        [planId, driverB.id],
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await mobileEvent(slowReader)).toBe("event: reset\ndata: {}\n\n");
      expect(await mobileEvent(slowReader)).toBe("closed");
      slowAbort.abort();
      await slowReader.cancel();

      const explicitCancel = new AbortController();
      const cancelReader = mobileEventStream(
        db.pool,
        `Bearer ${tokens[1]}`,
        driverB.id,
        explicitCancel.signal,
        60,
      ).getReader();
      expect(await mobileEvent(cancelReader)).toBe("event: reset\ndata: {}\n\n");
      await cancelReader.cancel();
      explicitCancel.abort();

      const reassignedSession = new AbortController();
      const reassignedReader = mobileEventStream(
        db.pool,
        `Bearer ${tokens[1]}`,
        driverB.id,
        reassignedSession.signal,
        60,
      ).getReader();
      expect(await mobileEvent(reassignedReader)).toBe("event: reset\ndata: {}\n\n");
      await db.pool.query(
        "UPDATE route_driver_mobile_sessions SET driver_id=$2,device_id=$3 WHERE token_hash=$1",
        [tokenHash(tokens[1]), driverA.id, deviceIds[0]],
      );
      await audit(db.pool, admin, "qa.mobile.session.identity.changed");
      expect(await mobileEvent(reassignedReader)).toBe("event: session-expired\ndata: {}\n\n");
      reassignedSession.abort();
      await reassignedReader.cancel();
    } finally {
      controllerA.abort();
      controllerB.abort();
      await readerA.cancel().catch(() => {});
      await readerB.cancel().catch(() => {});
      await db.pool.query(
        "DELETE FROM route_driver_mobile_sessions WHERE token_hash=ANY($1::text[])",
        [tokens.map(tokenHash)],
      );
      await db.pool.query(
        "DELETE FROM route_driver_mobile_devices WHERE id=ANY($1::uuid[])",
        [deviceIds],
      );
      await db.pool.query(
        "DELETE FROM route_driver_mobile_access WHERE driver_id=ANY($1::uuid[])",
        [drivers.map((current) => current.id)],
      );
    }
  });

  it("closes an invalid mobile session without returning a route", async () => {
    const abort = new AbortController();
    const reader = mobileEventStream(
      db.pool,
      `Bearer ${randomBytes(32).toString("hex")}`,
      driverA.id,
      abort.signal,
      1,
    ).getReader();
    try {
      expect(await mobileEvent(reader)).toBe("event: session-expired\ndata: {}\n\n");
      expect(await mobileEvent(reader)).toBe("closed");
    } finally {
      abort.abort();
      await reader.cancel().catch(() => {});
    }
  });

  it("does not retain a subscriber when the request was already cancelled", async () => {
    const abort = new AbortController();
    abort.abort();
    const reader = mobileEventStream(db.pool, "Bearer invalid", driverA.id, abort.signal, 1).getReader();
    expect(await mobileEvent(reader)).toBe("closed");
    await reader.cancel();
  });

  it("releases a subscription cancelled while waiting for a PostgreSQL connection", async () => {
    await expect.poll(async () => Number((await db.pool.query(
      "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE query='LISTEN ana_rutas_panel'",
    )).rows[0].n)).toBe(0);
    const held = await Promise.all(Array.from({ length: 6 }, () => db.pool.connect()));
    const abort = new AbortController();
    try {
      const reader = mobileEventStream(db.pool, "Bearer invalid", driverA.id, abort.signal, 1).getReader();
      abort.abort();
      expect(await mobileEvent(reader)).toBe("closed");
      await reader.cancel();
    } finally {
      held.forEach((client) => client.release());
    }
    await expect.poll(async () => Number((await db.pool.query(
      "SELECT count(*)::integer AS n FROM pg_stat_activity WHERE query='LISTEN ana_rutas_panel'",
    )).rows[0].n)).toBe(0);
  });

  it("does not let a valid token subscribe as another driver", async () => {
    const token = randomBytes(32).toString("hex");
    const deviceId = randomUUID();
    await db.pool.query(
      `INSERT INTO route_driver_mobile_access(driver_id,login_phone,pin_hash,updated_by)
       VALUES($1,$2,$3,$4)`,
      [driverA.id, mobilePhoneKey(driverA.phone), "integration-fixture", admin],
    );
    await db.pool.query(
      `INSERT INTO route_driver_mobile_devices(id,driver_id,public_key,public_key_hash)
       VALUES($1,$2,$3,$4)`,
      [deviceId, driverA.id, "integration-fixture", randomBytes(32).toString("hex")],
    );
    await db.pool.query(
      `INSERT INTO route_driver_mobile_sessions(token_hash,driver_id,device_id,expires_at)
       VALUES($1,$2,$3,now()+interval '1 hour')`,
      [tokenHash(token), driverA.id, deviceId],
    );
    const abort = new AbortController();
    const reader = mobileEventStream(db.pool, `Bearer ${token}`, driverB.id, abort.signal, 1).getReader();
    try {
      expect(await mobileEvent(reader)).toBe("event: session-expired\ndata: {}\n\n");
      expect(await mobileEvent(reader)).toBe("closed");
    } finally {
      abort.abort();
      await reader.cancel().catch(() => {});
      await db.pool.query("DELETE FROM route_driver_mobile_sessions WHERE token_hash=$1", [tokenHash(token)]);
      await db.pool.query("DELETE FROM route_driver_mobile_devices WHERE id=$1", [deviceId]);
      await db.pool.query("DELETE FROM route_driver_mobile_access WHERE driver_id=$1", [driverA.id]);
    }
  });
});

describe("driver mobile identity / real PostgreSQL and EC signatures", () => {
  it("validates exact PIN and canonical Mexican phone", () => {
    expect(mobilePhoneKey("+52 (33) 1234-5678")).toBe("3312345678");
    expect(mobilePhoneKey("  +52 (33) 1234-5678  ")).toBe("3312345678");
    expect(mobilePhoneKey("+5213312345678")).toBe("3312345678");
    expect(mobilePhoneKey("33 1234 5678")).toBe("3312345678");
    expect(mobilePhoneKey("33.1234.5678")).toBe("3312345678");
    expect(mobilePhoneKey("1234567890")).toBe("1234567890");
    const longestFormattedPhone = "1234567890" + " ".repeat(30);
    expect(mobilePhoneKey(longestFormattedPhone)).toBe("1234567890");
    expect(() => mobilePhoneKey(longestFormattedPhone + " ")).toThrow(
      "MOBILE_PHONE_INVALID",
    );
    expect(() => mobilePhoneKey("991234567890")).toThrow(
      "MOBILE_PHONE_INVALID",
    );
    expect(() => mobilePhoneKey("9991234567890")).toThrow(
      "MOBILE_PHONE_INVALID",
    );
    expect(() => mobilePhoneKey("cliente 3312345678")).toThrow(
      "MOBILE_PHONE_INVALID",
    );
    expect(() => mobilePhoneKey("33+12345678")).toThrow("MOBILE_PHONE_INVALID");
    expect(() => mobilePhoneKey("x3312345678")).toThrow("MOBILE_PHONE_INVALID");
    expect(() => mobilePhoneKey("331234567:")).toThrow("MOBILE_PHONE_INVALID");
    expect(() => mobilePhoneKey("123456789")).toThrow("MOBILE_PHONE_INVALID");
    expect(() => mobilePhoneKey("12345678901")).toThrow("MOBILE_PHONE_INVALID");
    expect(() => mobilePhoneKey("123456789012345")).toThrow(
      "MOBILE_PHONE_INVALID",
    );
    expect(() => mobilePhoneKey(3312345678)).toThrow("MOBILE_PHONE_INVALID");
    expect(mobilePin("0123")).toBe("0123");
    expect(() => mobilePin("123")).toThrow("MOBILE_PIN_INVALID");
    expect(() => mobilePin("123a")).toThrow("MOBILE_PIN_INVALID");
    expect(() => mobilePin("12/4")).toThrow("MOBILE_PIN_INVALID");
    expect(() => mobilePin(1234)).toThrow("MOBILE_PIN_INVALID");
  });

  it("requires the server-only PIN pepper and accepts its exact minimum length", async () => {
    const current = process.env.RUTAS_DRIVER_PIN_PEPPER;
    const isolated = await createDriver(
      db.pool,
      admin,
      driver("Chofer límite pepper", "3312345688"),
    );
    try {
      delete process.env.RUTAS_DRIVER_PIN_PEPPER;
      await expect(
        configureMobileAccess(db.pool, admin, isolated.id, {
          pin: "1029",
          expectedMobileVersion: 0,
        }),
      ).rejects.toThrow("MOBILE_CONFIG_MISSING");
      process.env.RUTAS_DRIVER_PIN_PEPPER = "x".repeat(31);
      await expect(
        configureMobileAccess(db.pool, admin, isolated.id, {
          pin: "1029",
          expectedMobileVersion: 0,
        }),
      ).rejects.toThrow("MOBILE_CONFIG_MISSING");
      process.env.RUTAS_DRIVER_PIN_PEPPER = "x".repeat(32);
      await expect(
        configureMobileAccess(db.pool, admin, isolated.id, {
          pin: "1029",
          expectedMobileVersion: 0,
        }),
      ).resolves.toMatchObject({ enabled: true, version: 1 });
    } finally {
      if (current === undefined) delete process.env.RUTAS_DRIVER_PIN_PEPPER;
      else process.env.RUTAS_DRIVER_PIN_PEPPER = current;
    }
  });

  it("rejects an unregistered phone without a server error or device record", async () => {
    const before = await db.pool.query(
      "SELECT count(*)::integer AS total FROM route_driver_mobile_devices",
    );
    await expect(
      enrollMobileDevice(db.pool, {
        phone: "3399999999",
        pin: "1234",
        publicKey: deviceKeys().publicKey,
      }),
    ).rejects.toMatchObject({ code: "MOBILE_LOGIN_INVALID", status: 401 });
    const after = await db.pool.query(
      "SELECT count(*)::integer AS total FROM route_driver_mobile_devices",
    );
    expect(after.rows[0].total).toBe(before.rows[0].total);
  });

  it("clears a failed PIN counter after a successful mobile enrollment", async () => {
    const isolated = await createDriver(
      db.pool,
      admin,
      driver("Chofer recuperación", "3312345687"),
    );
    await configureMobileAccess(db.pool, admin, isolated.id, {
      pin: "4821",
      expectedMobileVersion: 0,
    });
    const key = deviceKeys().publicKey;
    await expect(
      enrollMobileDevice(db.pool, {
        phone: isolated.phone,
        pin: "0000",
        publicKey: key,
      }),
    ).rejects.toThrow("MOBILE_LOGIN_INVALID");
    await enrollMobileDevice(db.pool, {
      phone: isolated.phone,
      pin: "4821",
      publicKey: key,
    });
    const access = await db.pool.query(
      "SELECT failed_attempts,locked_until FROM route_driver_mobile_access WHERE driver_id=$1",
      [isolated.id],
    );
    expect(access.rows[0]).toMatchObject({
      failed_attempts: 0,
      locked_until: null,
    });
  });

  it("protects credentials, activates one device and isolates its route", async () => {
    const status = await configureMobileAccess(db.pool, admin, driverA.id, {
      pin: "0123",
      expectedMobileVersion: 0,
    });
    expect(status).toMatchObject({ enabled: true, version: 1, devices: 0 });
    await expect(
      configureMobileAccess(db.pool, admin, driverB.id, {
        pin: "9876",
        expectedMobileVersion: 0,
      }),
    ).resolves.toMatchObject({ enabled: true });
    const raw = (
      await db.pool.query(
        "SELECT pin_hash FROM route_driver_mobile_access WHERE driver_id=$1",
        [driverA.id],
      )
    ).rows[0].pin_hash as string;
    expect(raw).not.toContain("0123");
    const keys = deviceKeys();
    const enrollment = await enrollMobileDevice(db.pool, {
      phone: driverA.phone,
      pin: "0123",
      publicKey: keys.publicKey,
    });
    expect(enrollment.driverId).toBe(driverA.id);
    const enrollmentAudit = await db.pool.query(
      "SELECT action,details FROM route_driver_mobile_audit WHERE driver_id=$1 ORDER BY id DESC LIMIT 1",
      [driverA.id],
    );
    expect(enrollmentAudit.rows[0]).toMatchObject({
      action: "mobile.device.enrolled",
      details: { deviceId: enrollment.deviceId },
    });
    expect(
      (await authenticateMobile(db.pool, `Bearer ${enrollment.token}`))
        .driver_id,
    ).toBe(driverA.id);
    await expect(
      enrollMobileDevice(db.pool, {
        phone: `+52 ${driverA.phone}`,
        pin: "0123",
        publicKey: keys.publicKey,
      }),
    ).resolves.toMatchObject({ deviceId: enrollment.deviceId });
    const plans = await listDriverPlans(db.pool, driverA.id);
    expect(plans).toHaveLength(1);
    const dashboard = await readDriverDashboard(
      db.pool,
      driverA.id,
      "America/Mexico_City",
      new Date("2026-09-22T04:30:00.000Z"),
    );
    expect(dashboard).toMatchObject({
      serviceDate: "2026-09-21",
      plans: [{ id: planId, vehicle_name: "Unidad A", orders: 1 }],
      today: {
        plan: { id: planId },
        vehicle: { name: "Unidad A" },
        orders: [{ orderName: "S501" }],
        routeStatus: "current",
        route: { vehicleName: "Unidad A" },
      },
    });
    expect(
      await readDriverDashboard(
        db.pool,
        driverA.id,
        "America/Mexico_City",
        new Date("2026-09-23T06:00:00.000Z"),
      ),
    ).toMatchObject({ serviceDate: "2026-09-23", today: null });
    const route = await readDriverPlan(
      db.pool,
      driverA.id,
      planId,
      "America/Mexico_City",
    );
    expect(route.orders).toHaveLength(1);
    expect(route.orders[0].orderName).toBe("S501");
    expect(route.routeStatus).toBe("current");
    expect(route.route).toMatchObject({ vehicleName: "Unidad A" });
    const challenge = await createMobileChallenge(db.pool, {
      phone: driverA.phone,
      deviceId: enrollment.deviceId,
    });
    const signature = sign(
      "sha256",
      Buffer.from(
        mobileChallengeMessage(challenge.challengeId, challenge.nonce),
      ),
      keys.privateKey,
    ).toString("base64");
    const login = await loginMobile(db.pool, {
      phone: driverA.phone,
      pin: "0123",
      deviceId: enrollment.deviceId,
      ...challenge,
      signature,
    });
    expect(login.driverId).toBe(driverA.id);
    await expect(
      loginMobile(db.pool, {
        phone: driverA.phone,
        pin: "0123",
        deviceId: enrollment.deviceId,
        ...challenge,
        signature,
      }),
    ).rejects.toThrow("MOBILE_LOGIN_INVALID");
    const newStatus = await configureMobileAccess(db.pool, admin, driverA.id, {
      pin: "4321",
      expectedMobileVersion: status.version,
    });
    expect(newStatus.devices).toBe(0);
    await expect(
      authenticateMobile(db.pool, `Bearer ${login.token}`),
    ).rejects.toThrow("MOBILE_UNAUTHENTICATED");
    await expect(
      enrollMobileDevice(db.pool, {
        phone: driverA.phone,
        pin: "0123",
        publicKey: keys.publicKey,
      }),
    ).rejects.toMatchObject({ code: "MOBILE_LOGIN_INVALID", status: 401 });
    const renewed = await enrollMobileDevice(db.pool, {
      phone: driverA.phone,
      pin: "4321",
      publicKey: keys.publicKey,
    });
    expect(renewed.deviceId).toBe(enrollment.deviceId);
    expect(
      (await authenticateMobile(db.pool, `Bearer ${renewed.token}`)).driver_id,
    ).toBe(driverA.id);
  });

  it("does not grant another driver's plan by a supplied ID", async () => {
    expect(await listDriverPlans(db.pool, randomUUID())).toEqual([]);
    await expect(
      readDriverPlan(db.pool, randomUUID(), planId, "America/Mexico_City"),
    ).rejects.toThrow("NOT_FOUND");
    const b = await readDriverPlan(
      db.pool,
      driverB.id,
      planId,
      "America/Mexico_City",
    );
    expect(b.orders).toHaveLength(1);
    expect(b.orders[0].orderName).toBe("S502");
  });

  it("does not expose an assigned vehicle without a published route", async () => {
    const emptyDriver = await createDriver(
      db.pool,
      admin,
      driver("Chofer sin pedidos", "3312345689"),
    );
    const emptyVehicle = await createVehicle(
      db.pool,
      admin,
      vehicle("Unidad sin pedidos"),
    );
    await assignDriver(db.pool, admin, emptyVehicle.id, {
      driver_id: emptyDriver.id,
      expectedVersion: emptyVehicle.version,
    });
    const emptyPlan = await createPlan(db.pool, admin, {
      date: "2026-09-24",
      label: "Ruta vacía",
    });
    await selectPlanVehicles(db.pool, admin, emptyPlan.id, {
      vehicleIds: [emptyVehicle.id],
      expectedVersion: emptyPlan.version,
    });
    await expect(
      readDriverPlan(
        db.pool,
        emptyDriver.id,
        emptyPlan.id,
        "America/Mexico_City",
      ),
    ).rejects.toThrow("NOT_FOUND");
    expect(await listDriverPlans(db.pool, emptyDriver.id)).toEqual([]);
  });

  it("revokes access after contact phone change and explicit admin revocation", async () => {
    const statusB = await mobileAccessStatus(db.pool, driverB.id);
    const changed = await editDriver(db.pool, admin, driverB.id, {
      ...driverB,
      phone: "3312345999",
      expectedVersion: driverB.version,
    });
    expect(changed.phone).toBe("3312345999");
    expect((await mobileAccessStatus(db.pool, driverB.id)).enabled).toBe(false);
    const statusA = await mobileAccessStatus(db.pool, driverA.id);
    expect(statusA.enabled).toBe(true);
    const revoked = await revokeMobileAccess(
      db.pool,
      admin,
      driverA.id,
      statusA.version,
    );
    expect(revoked.enabled).toBe(false);
    expect(statusB.version).toBeGreaterThan(0);
  });

  it("enforces normalized unique phone, idempotent enrollment and repeated PIN lockout", async () => {
    const repeatedPhone = "3312345680";
    const third = await createDriver(
      db.pool,
      admin,
      driver("Chofer C", repeatedPhone),
    );
    const fourth = await createDriver(
      db.pool,
      admin,
      driver("Chofer D", `+52 ${repeatedPhone}`),
    );
    await configureMobileAccess(db.pool, admin, third.id, {
      pin: "4821",
      expectedMobileVersion: 0,
    });
    await expect(
      configureMobileAccess(db.pool, admin, fourth.id, {
        pin: "9999",
        expectedMobileVersion: 0,
      }),
    ).rejects.toThrow("MOBILE_PHONE_EXISTS");
    await expect(
      enrollMobileDevice(db.pool, {
        phone: repeatedPhone,
        pin: "4821",
        publicKey: "not-a-public-key",
      }),
    ).rejects.toThrow("MOBILE_DEVICE_INVALID");
    const contenderKey = deviceKeys().publicKey;
    const contenders = await Promise.allSettled([
      enrollMobileDevice(db.pool, {
        phone: repeatedPhone,
        pin: "4821",
        publicKey: contenderKey,
      }),
      enrollMobileDevice(db.pool, {
        phone: `+52 ${repeatedPhone}`,
        pin: "4821",
        publicKey: contenderKey,
      }),
    ]);
    const winners = contenders.filter(
      (result) => result.status === "fulfilled",
    );
    expect(winners).toHaveLength(2);
    expect(
      new Set(
        (
          winners as PromiseFulfilledResult<
            Awaited<ReturnType<typeof enrollMobileDevice>>
          >[]
        ).map((result) => result.value.deviceId),
      ).size,
    ).toBe(1);
    const winner = winners[0] as PromiseFulfilledResult<
      Awaited<ReturnType<typeof enrollMobileDevice>>
    >;
    await logoutMobile(db.pool, `Bearer ${winner.value.token}`);
    await expect(
      authenticateMobile(db.pool, `Bearer ${winner.value.token}`),
    ).rejects.toThrow("MOBILE_UNAUTHENTICATED");
    const another = await createDriver(
      db.pool,
      admin,
      driver("Chofer E", "3312345681"),
    );
    await configureMobileAccess(db.pool, admin, another.id, {
      pin: "1357",
      expectedMobileVersion: 0,
    });
    await expect(
      enrollMobileDevice(db.pool, {
        phone: another.phone,
        pin: "1357",
        publicKey: contenderKey,
      }),
    ).rejects.toThrow("MOBILE_LOGIN_INVALID");
    const forbiddenDevice = await db.pool.query(
      "SELECT driver_id FROM route_driver_mobile_devices WHERE public_key_hash=$1",
      [createHash("sha256").update(contenderKey).digest("hex")],
    );
    expect(forbiddenDevice.rows[0].driver_id).toBe(third.id);
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(
        enrollMobileDevice(db.pool, {
          phone: repeatedPhone,
          pin: "0000",
          publicKey: deviceKeys().publicKey,
        }),
      ).rejects.toThrow("MOBILE_LOGIN_INVALID");
    }
    await expect(
      enrollMobileDevice(db.pool, {
        phone: repeatedPhone,
        pin: "4821",
        publicKey: deviceKeys().publicKey,
      }),
    ).rejects.toThrow("MOBILE_LOGIN_INVALID");
    const lock = await db.pool.query(
      "SELECT failed_attempts,locked_until FROM route_driver_mobile_access WHERE driver_id=$1",
      [third.id],
    );
    expect(lock.rows[0].failed_attempts).toBeGreaterThanOrEqual(5);
    expect(lock.rows[0].locked_until).toBeInstanceOf(Date);
  });
});
