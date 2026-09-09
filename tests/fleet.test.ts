import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { startPostgres } from "./helpers/postgres";
import { bootstrap } from "../src/core/auth";
import { migrate } from "../src/core/database";
import {
  assignDriver,
  createDriver,
  createVehicle,
  editDriver,
  editVehicle,
  getDriver,
  getVehicle,
  listDrivers,
  listVehicles,
} from "../src/core/fleet";
import {
  putDocument,
  readDocument,
  sanitizeDocument,
} from "../src/core/driver-documents";
import { maxDocumentBytes } from "../src/core/fleet-contract";
let db: Awaited<ReturnType<typeof startPostgres>>;
let actor: string;
let png: Buffer;
const unit = () => ({
  id: randomUUID(),
  name: "Camioneta QA",
  brand: "Marca QA",
  model: "Modelo QA",
  plate: randomUUID().slice(0, 8),
  mileage: 100,
  fuel: "Gasolina",
  available: true,
});
const driver = () => ({
  id: randomUUID(),
  name: "Chofer QA",
  phone: "3300000000",
  emergency_name: "Contacto QA",
  emergency_phone: "3300000001",
  blood_type: "",
  active: true,
});
beforeAll(async () => {
  db = await startPostgres();
  actor = (
    await bootstrap(db.pool, db.config, {
      token: db.config.bootstrapToken,
      name: "Fleet QA",
      login: "fleet-qa",
      password: randomUUID(),
    })
  ).id;
  png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#118844" },
  })
    .png()
    .toBuffer();
});
afterAll(async () => {
  await db?.close();
});
describe("fleet / real PostgreSQL", () => {
  it("upgrades actual v1 structure while preserving preexisting account and plan", async () => {
    // Only this isolated QA cluster: remove empty v2 tables to reproduce original v1 state.
    await db.pool.query(
      "DROP TABLE route_driver_documents,route_vehicles,route_drivers; UPDATE rutas_installation SET schema_version=1",
    );
    const id = randomUUID();
    await db.pool.query(
      "INSERT INTO route_plans(id,service_date,label,created_by,updated_by) VALUES($1,'2026-09-08','Existing QA',$2,$2)",
      [id, actor],
    );
    const users = (await db.pool.query("SELECT * FROM route_users")).rows;
    const plans = (await db.pool.query("SELECT * FROM route_plans")).rows;
    await Promise.all([
      migrate(db.pool, db.config.instanceId),
      migrate(db.pool, db.config.instanceId),
    ]);
    expect(
      (await db.pool.query("SELECT schema_version FROM rutas_installation"))
        .rows[0].schema_version,
    ).toBe(2);
    expect((await db.pool.query("SELECT * FROM route_users")).rows).toEqual(
      users,
    );
    expect((await db.pool.query("SELECT * FROM route_plans")).rows).toEqual(
      plans,
    );
    expect(await listVehicles(db.pool)).toEqual([]);
    expect(await listDrivers(db.pool)).toEqual([]);
  });
  it("creates idempotently and rejects duplicate plates or reused IDs with changed data", async () => {
    const data = unit();
    const a = await createVehicle(db.pool, actor, data);
    expect(await createVehicle(db.pool, actor, data)).toEqual(a);
    await expect(
      createVehicle(db.pool, actor, { ...data, name: "Other" }),
    ).rejects.toThrow("FLEET_CONFLICT");
    await expect(
      createVehicle(db.pool, actor, {
        ...data,
        id: randomUUID(),
        plate: data.plate.toLowerCase(),
      }),
    ).rejects.toThrow("PLATE_EXISTS");
    const d = driver();
    const b = await createDriver(db.pool, actor, d);
    expect(await createDriver(db.pool, actor, d)).toEqual(b);
    await expect(
      createDriver(db.pool, actor, { ...d, phone: "3300000009" }),
    ).rejects.toThrow("FLEET_CONFLICT");
    expect(
      (
        await db.pool.query(
          "SELECT action FROM route_audit WHERE entity_id=$1",
          [a.id],
        )
      ).rows,
    ).toEqual([{ action: "vehicle.created" }]);
  });
  it("updates fields and rejects stale writes without lost updates", async () => {
    const data = unit();
    const a = await createVehicle(db.pool, actor, data);
    const changes = await Promise.allSettled([
      editVehicle(db.pool, actor, a.id, {
        ...data,
        mileage: 200,
        expectedVersion: 1,
      }),
      editVehicle(db.pool, actor, a.id, {
        ...data,
        mileage: 300,
        expectedVersion: 1,
      }),
    ]);
    expect(changes.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect((await getVehicle(db.pool, a.id)).version).toBe(2);
    const other = await createVehicle(db.pool, actor, unit());
    await expect(
      editVehicle(db.pool, actor, other.id, { ...data, expectedVersion: 1 }),
    ).rejects.toThrow("PLATE_EXISTS");
    const d = driver();
    const b = await createDriver(db.pool, actor, d);
    expect(
      await editDriver(db.pool, actor, b.id, {
        ...d,
        blood_type: "O+",
        expectedVersion: 1,
      }),
    ).toMatchObject({ blood_type: "O+", version: 2 });
    await expect(
      editDriver(db.pool, actor, b.id, { ...d, expectedVersion: 1 }),
    ).rejects.toThrow("FLEET_CONFLICT");
  });
  it("allows exactly one simultaneous assignment and requires explicit release", async () => {
    const ad = unit(),
      bd = unit(),
      dd = driver();
    const a = await createVehicle(db.pool, actor, ad),
      b = await createVehicle(db.pool, actor, bd),
      d = await createDriver(db.pool, actor, dd);
    const attempts = await Promise.allSettled(
      [a, b].map((v) =>
        assignDriver(db.pool, actor, v.id, {
          driver_id: d.id,
          expectedVersion: 1,
        }),
      ),
    );
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    const current = (await listVehicles(db.pool)).find(
      (v) => v.driver_id === d.id,
    )!;
    expect(
      await assignDriver(db.pool, actor, current.id, {
        driver_id: d.id,
        expectedVersion: current.version,
      }),
    ).toEqual(current);
    await expect(
      editVehicle(db.pool, actor, current.id, {
        ...(current.id === a.id ? ad : bd),
        available: false,
        expectedVersion: current.version,
      }),
    ).rejects.toThrow("UNASSIGN_FIRST");
    await expect(
      editDriver(db.pool, actor, d.id, {
        ...dd,
        active: false,
        expectedVersion: 1,
      }),
    ).rejects.toThrow("UNASSIGN_FIRST");
    const released = await assignDriver(db.pool, actor, current.id, {
      driver_id: null,
      expectedVersion: current.version,
    });
    expect(released.driver_id).toBeNull();
    await editDriver(db.pool, actor, d.id, {
      ...dd,
      active: false,
      expectedVersion: 1,
    });
    await expect(
      assignDriver(db.pool, actor, current.id, {
        driver_id: d.id,
        expectedVersion: released.version,
      }),
    ).rejects.toThrow("FLEET_UNAVAILABLE");
    const availableDriver = await createDriver(db.pool, actor, driver());
    const unavailable = await createVehicle(db.pool, actor, {
      ...unit(),
      available: false,
    });
    await expect(
      assignDriver(db.pool, actor, unavailable.id, {
        driver_id: availableDriver.id,
        expectedVersion: 1,
      }),
    ).rejects.toThrow("FLEET_UNAVAILABLE");
  });
  it("denies missing records and deactivated actors", async () => {
    await expect(getDriver(db.pool, randomUUID())).rejects.toThrow(
      "FLEET_NOT_FOUND",
    );
    await expect(getVehicle(db.pool, randomUUID())).rejects.toThrow(
      "FLEET_NOT_FOUND",
    );
    await db.pool.query("UPDATE route_users SET active=false WHERE id=$1", [
      actor,
    ]);
    try {
      await expect(createVehicle(db.pool, actor, unit())).rejects.toThrow(
        "UNAUTHENTICATED",
      );
    } finally {
      await db.pool.query("UPDATE route_users SET active=true WHERE id=$1", [
        actor,
      ]);
    }
  });
  it("stores private raster content atomically and preserves files on invalid/stale replacement", async () => {
    const d = await createDriver(db.pool, actor, driver());
    const changed = await putDocument(
      db.pool,
      actor,
      d.id,
      "photo",
      1,
      png,
      "image/png",
    );
    expect(changed).toMatchObject({ version: 2, documents: ["photo"] });
    const original = await readDocument(db.pool, d.id, "photo");
    expect((await sharp(original).metadata()).format).toBe("webp");
    await expect(
      putDocument(db.pool, actor, d.id, "photo", 1, png, "image/png"),
    ).rejects.toThrow("FLEET_CONFLICT");
    await expect(
      putDocument(
        db.pool,
        actor,
        d.id,
        "photo",
        2,
        Buffer.from("corrupt"),
        "image/png",
      ),
    ).rejects.toThrow("DOCUMENT_INVALID");
    expect(await readDocument(db.pool, d.id, "photo")).toEqual(original);
    const front = await putDocument(
      db.pool,
      actor,
      d.id,
      "license_front",
      2,
      png,
      "image/png",
    );
    const back = await putDocument(
      db.pool,
      actor,
      d.id,
      "license_back",
      front.version,
      png,
      "image/png",
    );
    expect(back.documents).toHaveLength(3);
    await putDocument(
      db.pool,
      actor,
      d.id,
      "photo",
      back.version,
      png,
      "image/png",
    );
    await expect(readDocument(db.pool, randomUUID(), "photo")).rejects.toThrow(
      "FLEET_NOT_FOUND",
    );
    const auditRows = (
      await db.pool.query(
        "SELECT details FROM route_audit WHERE action='driver.document.saved' AND entity_id=$1",
        [d.id],
      )
    ).rows;
    expect(auditRows).toHaveLength(4);
    expect(JSON.stringify(auditRows)).not.toContain("3300000000");
  });
});
describe("image validation with actual decoder", () => {
  it("refuses empty, oversized, spoofed MIME, SVG, corrupt and unknown types", async () => {
    await expect(
      sanitizeDocument(Buffer.alloc(0), "image/png"),
    ).rejects.toThrow("DOCUMENT_TOO_LARGE");
    await expect(
      sanitizeDocument(Buffer.alloc(maxDocumentBytes + 1), "image/png"),
    ).rejects.toThrow("DOCUMENT_TOO_LARGE");
    await expect(sanitizeDocument(png, "image/jpeg")).rejects.toThrow(
      "DOCUMENT_INVALID",
    );
    await expect(sanitizeDocument(png, "application/pdf")).rejects.toThrow(
      "DOCUMENT_INVALID",
    );
    await expect(
      sanitizeDocument(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>',
        ),
        "image/png",
      ),
    ).rejects.toThrow("DOCUMENT_INVALID");
  });
  it("strips metadata and limits simultaneous decoders", async () => {
    const input = await sharp(png)
      .withExif({ IFD0: { Artist: "Private QA" } })
      .jpeg()
      .toBuffer();
    const output = await sanitizeDocument(input, "image/jpeg");
    expect((await sharp(output).metadata()).exif).toBeUndefined();
    const attempts = await Promise.allSettled(
      [1, 2, 3].map(() => sanitizeDocument(png, "image/png")),
    );
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    expect(await sanitizeDocument(output, "image/webp")).toBeInstanceOf(Buffer);
  });
});
