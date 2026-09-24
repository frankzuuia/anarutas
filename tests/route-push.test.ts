import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { startPostgres } from "./helpers/postgres";
import { bootstrap } from "../src/core/auth";
import { assignDriver, createDriver, createVehicle } from "../src/core/fleet";
import { createPlan } from "../src/core/plans";
import { selectPlanVehicles } from "../src/core/orders";
import { authenticateMobile, logoutMobile } from "../src/core/driver-mobile-auth";
import { registerMobilePush, firebaseInstallationId } from "../src/core/route-push-registration";
import { claimRoutePush, dispatchRoutePushBatch, firebasePushFailure, readFirebasePushConfig, routePushMessage, shouldSendRoutePush } from "../src/core/route-push";
import { cancelPublishedRoute as cancelStartedRoute } from "../src/core/route-publications";
import { tokenHash } from "../src/core/crypto";

describe("route push decision and FCM contract", () => {
  const base = { driver_id: "a", revision: 2, kind: "published" as const };
  it("accepts only installation identifiers and never trusts a client's driver target", () => {
    const fid = randomBytes(18).toString("base64url");
    expect(firebaseInstallationId(fid)).toHaveLength(24);
    expect(() => firebaseInstallationId("bad fid")).toThrow("MOBILE_PUSH_ID_INVALID");
    expect(() => firebaseInstallationId(123)).toThrow("MOBILE_PUSH_ID_INVALID");
    expect(() => firebaseInstallationId({ toString: () => fid })).toThrow("MOBILE_PUSH_ID_INVALID");
    expect(() => firebaseInstallationId(`!${fid}`)).toThrow("MOBILE_PUSH_ID_INVALID");
    expect(() => firebaseInstallationId(`${fid}!`)).toThrow("MOBILE_PUSH_ID_INVALID");
    expect(shouldSendRoutePush(base, { fid: "fid", current_driver_id: "a", current_revision: 2, revoked_at: null })).toBe(true);
    expect(shouldSendRoutePush(base, { fid: null, current_driver_id: "a", current_revision: 2, revoked_at: null })).toBe(false);
    expect(shouldSendRoutePush(base, { fid: "fid", current_driver_id: "b", current_revision: 2, revoked_at: null })).toBe(false);
    expect(shouldSendRoutePush(base, { fid: "fid", current_driver_id: "a", current_revision: 3, revoked_at: null })).toBe(false);
    expect(shouldSendRoutePush(base, { fid: "fid", current_driver_id: "a", current_revision: 2, revoked_at: new Date() })).toBe(false);
    expect(shouldSendRoutePush({ ...base, kind: "withdrawn" }, { fid: "fid", current_driver_id: "b", current_revision: 3, revoked_at: null })).toBe(true);
    expect(shouldSendRoutePush({ ...base, kind: "withdrawn" }, { fid: "fid", current_driver_id: null, current_revision: null, revoked_at: null })).toBe(true);
    expect(shouldSendRoutePush({ ...base, kind: "withdrawn" }, { fid: "fid", current_driver_id: "a", current_revision: 3, revoked_at: new Date() })).toBe(true);
    expect(shouldSendRoutePush({ ...base, kind: "withdrawn" }, { fid: "fid", current_driver_id: "a", current_revision: 3, revoked_at: null })).toBe(false);
  });

  it("sends a minimal FID payload and classifies permanent vs retryable failures", () => {
    const message = routePushMessage({
      id: "1", device_id: "d", driver_id: "a", plan_id: "p", vehicle_id: "v",
      revision: 2, kind: "published", attempts: 1,
    }, "installation-id");
    expect(message.message.fid).toBe("installation-id");
    expect(message.message.data).toEqual({ event: "route_published", planId: "p", revision: "2" });
    expect(message.message.notification).toEqual({
      title: "Nueva ruta disponible", body: "Tu ruta ya está lista. Abre Ana Rutas para verla.",
    });
    expect(message.message.android).toEqual({
      priority: "HIGH", ttl: "14400s", notification: { channel_id: "routes" },
    });
    const withdrawn = routePushMessage({
      id: "2", device_id: "d", driver_id: "a", plan_id: "p", vehicle_id: "v",
      revision: 3, kind: "withdrawn", attempts: 1,
    }, "installation-id");
    expect(withdrawn.message.data).toEqual({ event: "route_withdrawn", planId: "p", revision: "3" });
    expect(withdrawn.message.notification).toEqual({
      title: "Ruta retirada", body: "Administración retiró tu ruta. Abre Ana Rutas para ver tu jornada.",
    });
    expect(JSON.stringify(message)).not.toMatch(/customer|phone|address|order/i);
    expect(firebasePushFailure(404, "UNREGISTERED")).toBe("invalid_fid");
    expect(firebasePushFailure(429, "RESOURCE_EXHAUSTED")).toBe("retry");
    expect(firebasePushFailure(403, "PERMISSION_DENIED")).toBe("retry");
    expect(firebasePushFailure(400, "INVALID_ARGUMENT")).toBe("discard");
    expect(firebasePushFailure(500, "INTERNAL")).toBe("retry");
    expect(firebasePushFailure(401, "UNAUTHENTICATED")).toBe("retry");
  });

  it("rejects absent, malformed, or cross-project credentials before a worker starts", () => {
    const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
      .export({ type: "pkcs8", format: "pem" });
    const credentials = Buffer.from(JSON.stringify({
      type: "service_account", project_id: "ana-rutas-five-dev-2026",
      client_email: "sender@ana-rutas-five-dev-2026.iam.gserviceaccount.com",
      private_key: privateKey, token_uri: "https://oauth2.googleapis.com/token",
    })).toString("base64");
    expect(() => readFirebasePushConfig({})).toThrow("PUSH_CONFIG_MISSING");
    expect(() => readFirebasePushConfig({
      RUTAS_FIREBASE_PROJECT_ID: "ana-rutas-five-dev-2026",
    })).toThrow("PUSH_CONFIG_MISSING");
    expect(() => readFirebasePushConfig({
      RUTAS_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: credentials,
    })).toThrow("PUSH_CONFIG_MISSING");
    expect(() => readFirebasePushConfig({
      RUTAS_FIREBASE_PROJECT_ID: "bad_project", RUTAS_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: credentials,
    })).toThrow("PUSH_CONFIG_INVALID");
    expect(() => readFirebasePushConfig({
      RUTAS_FIREBASE_PROJECT_ID: "!ana-rutas-five-dev-2026", RUTAS_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: credentials,
    })).toThrow("PUSH_CONFIG_INVALID");
    expect(() => readFirebasePushConfig({
      RUTAS_FIREBASE_PROJECT_ID: "ana-rutas-five-dev-2026!", RUTAS_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: credentials,
    })).toThrow("PUSH_CONFIG_INVALID");
    for (const projectId of ["!ana-rutas-five-dev-2026", "ana-rutas-five-dev-2026!"]) {
      const matchingCredentials = Buffer.from(JSON.stringify({
        type: "service_account", project_id: projectId,
        client_email: "sender@ana-rutas-five-dev-2026.iam.gserviceaccount.com",
        private_key: privateKey, token_uri: "https://oauth2.googleapis.com/token",
      })).toString("base64");
      expect(() => readFirebasePushConfig({
        RUTAS_FIREBASE_PROJECT_ID: projectId,
        RUTAS_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: matchingCredentials,
      })).toThrow("PUSH_CONFIG_INVALID");
    }
    expect(() => readFirebasePushConfig({
      RUTAS_FIREBASE_PROJECT_ID: "ana-rutas-five-dev-2026", RUTAS_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: "bad",
    })).toThrow("PUSH_CONFIG_INVALID");
    expect(() => readFirebasePushConfig({
      RUTAS_FIREBASE_PROJECT_ID: "another-project", RUTAS_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: credentials,
    })).toThrow("PUSH_CONFIG_INVALID");
    expect(readFirebasePushConfig({
      RUTAS_FIREBASE_PROJECT_ID: " ana-rutas-five-dev-2026 ",
      RUTAS_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: ` ${credentials} `,
    }).credentials.client_email).toBe("sender@ana-rutas-five-dev-2026.iam.gserviceaccount.com");
  });
});

describe("route push transactional outbox / PostgreSQL real", () => {
  let db: Awaited<ReturnType<typeof startPostgres>>;
  let actor: string;
  let planId: string;
  let planVersion: number;
  let vehicleId: string;
  let driverA: string;
  let driverB: string;
  let deviceA: string;
  let deviceB: string;
  let bearerA: string;
  let bearerB: string;

  beforeAll(async () => {
    db = await startPostgres();
    actor = (await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken, name: "Push QA", login: "push-qa", password: randomUUID(),
    })).id;
    const makeDriver = async (phone: string) => (await createDriver(db.pool, actor, {
      id: randomUUID(), name: `Chofer ${phone}`, phone, emergency_name: "", emergency_phone: "",
      blood_type: "", active: true,
    })).id;
    driverA = await makeDriver("3311111111");
    driverB = await makeDriver("3322222222");
    const vehicle = await createVehicle(db.pool, actor, {
      id: randomUUID(), name: "Camioneta QA", brand: "Ford", model: "Transit",
      plate: randomUUID().slice(0, 8), mileage: 0, fuel: "Gasolina", available: true,
    });
    vehicleId = vehicle.id;
    await assignDriver(db.pool, actor, vehicleId, { driver_id: driverA, expectedVersion: vehicle.version });
    const plan = await createPlan(db.pool, actor, { date: "2026-09-23", label: "Push real QA" });
    planId = plan.id;
    planVersion = plan.version;
    await selectPlanVehicles(db.pool, actor, planId, { vehicleIds: [vehicleId], expectedVersion: plan.version });
    deviceA = randomUUID();
    deviceB = randomUUID();
    bearerA = randomBytes(32).toString("hex");
    bearerB = randomBytes(32).toString("hex");
    for (const [driver, phone, device, bearer] of [
      [driverA, "3311111111", deviceA, bearerA],
      [driverB, "3322222222", deviceB, bearerB],
    ]) {
      await db.pool.query(
        `INSERT INTO route_driver_mobile_access(driver_id,login_phone,pin_hash,updated_by)
         VALUES($1,$2,'qa-hash',$3)`, [driver, phone, actor],
      );
      await db.pool.query(
        `INSERT INTO route_driver_mobile_devices(id,driver_id,public_key,public_key_hash)
         VALUES($1,$2,'qa-key',$3)`, [device, driver, createHash("sha256").update(device).digest("hex")],
      );
      await db.pool.query(
        `INSERT INTO route_driver_mobile_sessions(token_hash,driver_id,device_id,expires_at)
         VALUES($1,$2,$3,now()+interval '12 hours')`, [tokenHash(bearer), driver, device],
      );
    }
  });
  afterAll(async () => { await db?.close(); });

  it("binds each FID to its authenticated device and rejects active cross-driver takeover", async () => {
    const principalA = await authenticateMobile(db.pool, `Bearer ${bearerA}`);
    const principalB = await authenticateMobile(db.pool, `Bearer ${bearerB}`);
    expect(principalA.device_id).toBe(deviceA);
    const fidA = randomBytes(18).toString("base64url");
    await registerMobilePush(db.pool, principalA, fidA, `Bearer ${bearerA}`);
    await expect(registerMobilePush(db.pool, principalB, fidA, `Bearer ${bearerB}`)).rejects.toMatchObject({ code: "23505" });
    const fidB = randomBytes(18).toString("base64url");
    await registerMobilePush(db.pool, principalB, fidB, `Bearer ${bearerB}`);
    const rows = await db.pool.query("SELECT driver_id,device_id FROM route_mobile_push_registrations ORDER BY driver_id");
    expect(rows.rows).toEqual(expect.arrayContaining([
      { driver_id: driverA, device_id: deviceA }, { driver_id: driverB, device_id: deviceB },
    ]));
  });

  it("queues only committed publish/revision/reassignment/cancellation changes, not start or rollback", async () => {
    const hash = createHash("sha256").update("first").digest("hex");
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO route_plan_publications
         (plan_id,vehicle_id,driver_id,source_plan_version,snapshot,snapshot_hash,published_by)
         VALUES($1,$2,$3,$4,'{}'::jsonb,$5,$6)`,
        [planId, vehicleId, driverA, planVersion, hash, actor],
      );
      await client.query("ROLLBACK");
    } finally { client.release(); }
    expect((await db.pool.query("SELECT count(*)::integer AS n FROM route_mobile_push_deliveries")).rows[0].n).toBe(0);
    await db.pool.query(
      `INSERT INTO route_plan_publications
       (plan_id,vehicle_id,driver_id,source_plan_version,snapshot,snapshot_hash,published_by)
       VALUES($1,$2,$3,$4,'{}'::jsonb,$5,$6)`,
      [planId, vehicleId, driverA, planVersion, hash, actor],
    );
    await db.pool.query("UPDATE route_plan_publications SET published_at=now() WHERE plan_id=$1", [planId]);
    expect((await db.pool.query("SELECT kind,driver_id FROM route_mobile_push_deliveries ORDER BY id")).rows)
      .toEqual([{ kind: "published", driver_id: driverA }]);
    await db.pool.query(
      "UPDATE route_plan_publications SET revision=revision+1,snapshot_hash=$2 WHERE plan_id=$1",
      [planId, createHash("sha256").update("second").digest("hex")],
    );
    await db.pool.query("UPDATE route_plan_publications SET driver_id=$2,revision=revision+1 WHERE plan_id=$1", [planId, driverB]);
    let changes = (await db.pool.query("SELECT kind,driver_id FROM route_mobile_push_deliveries ORDER BY id")).rows;
    expect(changes).toEqual([
      { kind: "published", driver_id: driverA },
      { kind: "published", driver_id: driverA },
      { kind: "withdrawn", driver_id: driverA },
      { kind: "published", driver_id: driverB },
    ]);
    await db.pool.query(
      "UPDATE route_plan_publications SET started_at=now(),started_driver_id=$2 WHERE plan_id=$1",
      [planId, driverB],
    );
    expect((await db.pool.query("SELECT count(*)::integer AS n FROM route_mobile_push_deliveries")).rows[0].n).toBe(4);
    await cancelStartedRoute(db.pool, actor, planId, vehicleId, {
      expectedVersion: planVersion + 1, expectedRevision: 3,
    });
    changes = (await db.pool.query("SELECT kind,driver_id FROM route_mobile_push_deliveries ORDER BY id")).rows;
    expect(changes.at(-1)).toEqual({ kind: "withdrawn", driver_id: driverB });
    expect(changes).toHaveLength(5);
    const [first, second] = await Promise.all([claimRoutePush(db.pool), claimRoutePush(db.pool)]);
    expect(first.length + second.length).toBe(5);
    expect(new Set([...first, ...second].map((item) => item.id)).size).toBe(5);
  });

  it("disables push on logout without deleting the route audit trail", async () => {
    await logoutMobile(db.pool, `Bearer ${bearerA}`);
    const registration = await db.pool.query("SELECT disabled_at FROM route_mobile_push_registrations WHERE device_id=$1", [deviceA]);
    expect(registration.rows[0].disabled_at).toBeInstanceOf(Date);
    await expect(authenticateMobile(db.pool, `Bearer ${bearerA}`)).rejects.toThrow("MOBILE_UNAUTHENTICATED");
  });

  it("cancels before start, emits one withdrawal, keeps the draft and rejects a stale second cancellation", async () => {
    await db.pool.query(
      "UPDATE route_plan_publications SET revoked_at=NULL,revision=revision+1 WHERE plan_id=$1", [planId],
    );
    const publication = (await db.pool.query(
      "SELECT revision,started_at FROM route_plan_publications WHERE plan_id=$1", [planId],
    )).rows[0];
    expect(publication.started_at).toBeNull();
    const input = { expectedVersion: planVersion + 1, expectedRevision: publication.revision };
    const attempts = await Promise.allSettled([
      cancelStartedRoute(db.pool, actor, planId, vehicleId, input),
      cancelStartedRoute(db.pool, actor, planId, vehicleId, input),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    const revoked = (await db.pool.query(
      "SELECT revoked_at,started_at,revision FROM route_plan_publications WHERE plan_id=$1", [planId],
    )).rows[0];
    expect(revoked.revoked_at).toBeInstanceOf(Date);
    expect(revoked.started_at).toBeNull();
    expect(revoked.revision).toBe(publication.revision + 1);
    expect((await db.pool.query("SELECT id FROM route_plans WHERE id=$1", [planId])).rowCount).toBe(1);
    expect((await db.pool.query(
      "SELECT id FROM route_mobile_push_deliveries WHERE plan_id=$1 AND revision=$2 AND kind='withdrawn' AND driver_id=$3",
      [planId, revoked.revision, driverB],
    )).rowCount).toBe(1);
    expect((await db.pool.query(
      "SELECT details FROM route_audit WHERE action='route.publication.cancelled' AND entity_id=$1", [planId],
    )).rows[0].details).toMatchObject({ startedAt: null, previousRevision: publication.revision });
    // Keep later lease/expiry assertions isolated from these new deliveries.
    await claimRoutePush(db.pool);
  });

  it("discards expired deliveries instead of sending them after a worker outage", async () => {
    const { rows } = await db.pool.query("SELECT id FROM route_mobile_push_deliveries ORDER BY id LIMIT 1");
    await db.pool.query(
      "UPDATE route_mobile_push_deliveries SET expires_at=now()-interval '1 second',claimed_until=NULL WHERE id=$1",
      [rows[0].id],
    );
    expect(await claimRoutePush(db.pool)).toEqual([]);
    const result = await db.pool.query(
      "SELECT discarded_at,last_error FROM route_mobile_push_deliveries WHERE id=$1", [rows[0].id],
    );
    expect(result.rows[0].discarded_at).toBeInstanceOf(Date);
    expect(result.rows[0].last_error).toBe("EXPIRED");
  });

  it.skipIf(process.env.ANA_RUTAS_LIVE_FCM_QA !== "1")(
    "uses real Google OAuth and FCM to retire a nonexistent FID without notifying a driver",
    async () => {
      const fakeFid = randomBytes(18).toString("base64url");
      await db.pool.query(
        "UPDATE route_mobile_push_registrations SET fid=$2,disabled_at=NULL WHERE device_id=$1",
        [deviceB, fakeFid],
      );
      const inserted = await db.pool.query(
        `INSERT INTO route_mobile_push_deliveries
          (device_id,driver_id,plan_id,vehicle_id,revision,kind)
         VALUES($1,$2,$3,$4,99,'withdrawn') RETURNING id`,
        [deviceB, driverB, planId, vehicleId],
      );
      expect(await dispatchRoutePushBatch(db.pool, readFirebasePushConfig())).toBe(1);
      const result = await db.pool.query(
        "SELECT discarded_at,last_error FROM route_mobile_push_deliveries WHERE id=$1",
        [inserted.rows[0].id],
      );
      expect(result.rows[0].discarded_at).toBeInstanceOf(Date);
      expect(result.rows[0].last_error).toBe("UNREGISTERED");
      const registration = await db.pool.query(
        "SELECT disabled_at FROM route_mobile_push_registrations WHERE device_id=$1", [deviceB],
      );
      expect(registration.rows[0].disabled_at).toBeInstanceOf(Date);
    },
    30_000,
  );
});
