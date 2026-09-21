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
import {
  orderBoard,
  persistImportPage,
  selectPlanVehicles,
} from "../src/core/orders";
import {
  authenticateMobile,
  configureMobileAccess,
  createMobileActivation,
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
  listDriverPlans,
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
});

afterAll(async () => {
  await db?.close();
  if (originalPepper === undefined) delete process.env.RUTAS_DRIVER_PIN_PEPPER;
  else process.env.RUTAS_DRIVER_PIN_PEPPER = originalPepper;
});

describe("driver mobile identity / real PostgreSQL and EC signatures", () => {
  it("validates exact PIN and canonical phone without inferring a country", () => {
    expect(mobilePhoneKey("+52 (33) 1234-5678")).toBe("523312345678");
    expect(mobilePhoneKey("33 1234 5678")).toBe("3312345678");
    expect(mobilePhoneKey("33.1234.5678")).toBe("3312345678");
    expect(mobilePhoneKey("1234567890")).toBe("1234567890");
    expect(mobilePhoneKey("123456789012345")).toBe("123456789012345");
    expect(() => mobilePhoneKey("cliente 3312345678")).toThrow(
      "MOBILE_PHONE_INVALID",
    );
    expect(() => mobilePhoneKey("33+12345678")).toThrow("MOBILE_PHONE_INVALID");
    expect(() => mobilePhoneKey("x3312345678")).toThrow("MOBILE_PHONE_INVALID");
    expect(() => mobilePhoneKey("331234567:")).toThrow("MOBILE_PHONE_INVALID");
    expect(() => mobilePhoneKey("123456789")).toThrow("MOBILE_PHONE_INVALID");
    expect(() => mobilePhoneKey("1234567890123456")).toThrow(
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
    const activation = await createMobileActivation(
      db.pool,
      admin,
      driverA.id,
      status.version,
    );
    const keys = deviceKeys();
    const enrollment = await enrollMobileDevice(db.pool, {
      phone: driverA.phone,
      pin: "0123",
      code: activation.code,
      publicKey: keys.publicKey,
    });
    expect(enrollment.driverId).toBe(driverA.id);
    expect(
      (await authenticateMobile(db.pool, `Bearer ${enrollment.token}`))
        .driver_id,
    ).toBe(driverA.id);
    await expect(
      enrollMobileDevice(db.pool, {
        phone: driverA.phone,
        pin: "0123",
        code: activation.code,
        publicKey: deviceKeys().publicKey,
      }),
    ).rejects.toThrow("MOBILE_LOGIN_INVALID");
    const plans = await listDriverPlans(db.pool, driverA.id);
    expect(plans).toHaveLength(1);
    const route = await readDriverPlan(db.pool, driverA.id, planId);
    expect(route.orders).toHaveLength(1);
    expect(route.orders[0].orderName).toBe("S501");
    expect(route.routeStatus).toBe("not_calculated");
    expect(route.route).toBeNull();
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
  });

  it("does not grant another driver's plan by a supplied ID", async () => {
    expect(await listDriverPlans(db.pool, randomUUID())).toEqual([]);
    await expect(readDriverPlan(db.pool, randomUUID(), planId)).rejects.toThrow(
      "NOT_FOUND",
    );
    const b = await readDriverPlan(db.pool, driverB.id, planId);
    expect(b.orders).toHaveLength(1);
    expect(b.orders[0].orderName).toBe("S502");
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

  it("enforces unique phone, consumes activation once under concurrency and locks repeated PIN failures", async () => {
    const repeatedPhone = "3312345680";
    const third = await createDriver(
      db.pool,
      admin,
      driver("Chofer C", repeatedPhone),
    );
    const fourth = await createDriver(
      db.pool,
      admin,
      driver("Chofer D", repeatedPhone),
    );
    const status = await configureMobileAccess(db.pool, admin, third.id, {
      pin: "4821",
      expectedMobileVersion: 0,
    });
    await expect(
      configureMobileAccess(db.pool, admin, fourth.id, {
        pin: "9999",
        expectedMobileVersion: 0,
      }),
    ).rejects.toThrow("MOBILE_PHONE_EXISTS");
    const activation = await createMobileActivation(
      db.pool,
      admin,
      third.id,
      status.version,
    );
    const stored = await db.pool.query(
      "SELECT code_hash FROM route_driver_mobile_activations WHERE driver_id=$1",
      [third.id],
    );
    expect(stored.rows[0].code_hash).not.toBe(activation.code);
    await expect(
      enrollMobileDevice(db.pool, {
        phone: repeatedPhone,
        pin: "4821",
        code: activation.code,
        publicKey: "not-a-public-key",
      }),
    ).rejects.toThrow("MOBILE_DEVICE_INVALID");
    const contenders = await Promise.allSettled([
      enrollMobileDevice(db.pool, {
        phone: repeatedPhone,
        pin: "4821",
        code: activation.code,
        publicKey: deviceKeys().publicKey,
      }),
      enrollMobileDevice(db.pool, {
        phone: repeatedPhone,
        pin: "4821",
        code: activation.code,
        publicKey: deviceKeys().publicKey,
      }),
    ]);
    const winners = contenders.filter(
      (result) => result.status === "fulfilled",
    );
    expect(winners).toHaveLength(1);
    const winner = winners[0] as PromiseFulfilledResult<
      Awaited<ReturnType<typeof enrollMobileDevice>>
    >;
    await logoutMobile(db.pool, `Bearer ${winner.value.token}`);
    await expect(
      authenticateMobile(db.pool, `Bearer ${winner.value.token}`),
    ).rejects.toThrow("MOBILE_UNAUTHENTICATED");
    const next = await createMobileActivation(
      db.pool,
      admin,
      third.id,
      status.version,
    );
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(
        enrollMobileDevice(db.pool, {
          phone: repeatedPhone,
          pin: "0000",
          code: next.code,
          publicKey: deviceKeys().publicKey,
        }),
      ).rejects.toThrow("MOBILE_LOGIN_INVALID");
    }
    await expect(
      enrollMobileDevice(db.pool, {
        phone: repeatedPhone,
        pin: "4821",
        code: next.code,
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
