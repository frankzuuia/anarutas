import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import sharp from "sharp";
import { executionFixture } from "./helpers/driver-execution";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import {
  reportProductIncident,
  classifyProductIncident,
} from "../src/core/product-incidents";
import { reportProductIncidentWithPhotos } from "../src/core/product-incidents-evidence";
import { createUser } from "../src/core/auth";
import { migrate, transaction } from "../src/core/database";
import { openDriverCase } from "../src/core/driver-service-cases";
import {
  alarmSettingsInput,
  incidentIdentity,
  notificationSequence,
  readIncidentAlerts,
  readIncidentBoard,
  markIncidentSeen,
  updateIncidentAlarm,
} from "../src/core/incident-board";
import {
  incidentGroup,
  newIncidentSequences,
} from "../src/core/incident-board-policy";

it("IO input contracts reject spoofed identity, durations and cursors; grouping and deduplication are exact", () => {
  const id = randomUUID();
  for (const source of ["product", "service", "stop"])
    expect(incidentIdentity(`${source}:${id}`)).toEqual({ source, id });
  for (const value of [
    null,
    12,
    "product",
    `other:${id}`,
    `product:${id}:extra`,
    `product:no`,
  ])
    expect(() => incidentIdentity(value)).toThrow();
  for (const value of ["0", "1", "9007199254740993", "9223372036854775807"])
    expect(notificationSequence(value)).toBe(value);
  for (const value of [
    0,
    null,
    "",
    "-1",
    "01",
    "1.2",
    "1e3",
    "9223372036854775808",
    "99999999999999999999",
  ])
    expect(() => notificationSequence(value)).toThrow();
  for (const seconds of [5, 10, 15])
    expect(alarmSettingsInput({ seconds, expectedVersion: 1 })).toEqual({
      seconds,
      version: 1,
    });
  for (const seconds of [0, 4, 6, 20, "5", null])
    expect(() => alarmSettingsInput({ seconds, expectedVersion: 1 })).toThrow();
  expect(() =>
    alarmSettingsInput({ seconds: 5, expectedVersion: 1, actor: id }),
  ).toThrow();
  expect(() =>
    alarmSettingsInput({ seconds: 5, expectedVersion: 0 }),
  ).toThrow();
  expect(incidentGroup("return")).toBe("Devoluciones");
  expect(incidentGroup("replacement_quality")).toBe("Reposiciones");
  expect(incidentGroup("shortage_validation")).toBe("Faltantes");
  expect(incidentGroup("late_arrival")).toBe("Llegadas fuera de horario");
  expect(incidentGroup("unknown")).toBe("Otras incidencias");
  expect(
    newIncidentSequences("9007199254740992", [
      { sequence: "9007199254740993" },
      { sequence: "9007199254740993" },
      { sequence: "1" },
    ]),
  ).toEqual(["9007199254740993"]);
});

it("IO15–33: real migration, unseen shared first-writer, paging, rollback and ordered notification commits", async () => {
  const f = await executionFixture();
  try {
    await f.start();
    const current = () =>
      readDriverExecution(
        f.db.pool,
        f.members[0].driverId,
        f.planId,
        f.timezone,
      );
    let route = await current();
    const stop = route.stops[0],
      shipment = stop.shipmentIds[0];
    const identity = async () => {
      route = await current();
      const s = route.stops[0];
      return {
        commandId: randomUUID(),
        executionId: route.id,
        publicationRevision: route.publicationRevision,
        executionRevision: route.revision,
        stopVersion: s.version,
        visitSequence: s.visitSequence,
        orderVersion: s.orderStates[0].version,
        policyVersion: route.policy.version,
      };
    };
    await executeStopCommand(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stop.id,
      "arrival",
      {
        ...(await identity()),
        sample: {
          latitude: 20.64,
          longitude: -103.4,
          accuracyMeters: 5,
          ageMilliseconds: 0,
          capturedAt: f.now.toISOString(),
          mock: false,
        },
      },
      f.timezone,
      f.now,
    );
    const capture = async (kind = "shortage_validation") =>
      reportProductIncident(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        stop.id,
        shipment,
        {
          ...(await identity()),
          formVersion: 3,
          kind,
          quantity: "1",
          product: "Producto faltante",
          unit: "kg",
          department: "Compras",
          concept: "Error en compra",
          comments: ["product_not_ordered"],
          ...(kind === "shortage_warehouse"
            ? { warehouseReason: "product_not_ordered" }
            : {}),
        },
        f.timezone,
        f.now,
      );
    const historical = await capture();
    // A true v46 reconstruction: source incidents exist; notifications did not.
    await f.db.pool
      .query(`DROP TRIGGER incident_notification_created ON route_product_incidents;
      DROP TRIGGER incident_notification_created ON route_driver_service_incidents;
      DROP TRIGGER incident_notification_created ON route_driver_stop_events;
      DROP VIEW route_incident_live_entries; DROP TABLE route_incident_notifications,route_incident_alert_settings;
      UPDATE rutas_installation SET schema_version=46`);
    await Promise.all([
      migrate(f.db.pool, f.db.config.instanceId),
      migrate(f.db.pool, f.db.config.instanceId),
    ]);
    const board = (p = new URLSearchParams()) =>
      readIncidentBoard(f.db.pool, f.actor, p, f.timezone);
    expect((await board()).rows[0].notification).toBeNull();
    expect(
      (await readIncidentAlerts(f.db.pool, f.actor, new URLSearchParams()))
        .cursor,
    ).toBe("0");
    await expect(
      markIncidentSeen(f.db.pool, f.actor, {
        key: `product:${historical.incidentId}`,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const recorded = await capture(),
      key = `product:${recorded.incidentId}`;
    const warehouse = await capture("shortage_warehouse");
    const bytes = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#ffaa44" },
    })
      .jpeg()
      .toBuffer();
    for (const kind of [
      "return",
      "replacement_quality",
      "replacement_wrong_product",
    ])
      await reportProductIncidentWithPhotos(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        stop.id,
        shipment,
        {
          ...(await identity()),
          formVersion: 3,
          kind,
          lineIndex: 0,
          quantity: "0.25",
          comments:
            kind === "return" ? ["damaged_product"] : ["product_not_ordered"],
          ...(kind === "return"
            ? {}
            : { department: "Ventas", concept: "Error en compra" }),
        },
        f.timezone,
        [{ bytes, contentType: "image/jpeg" }],
        f.photoRoot,
        f.now,
      );
    const report = await board();
    expect(report.total).toBe(6);
    expect(report.unseen).toBe(5);
    expect(new Set(report.rows.map((row) => row.kind)).size).toBe(5);
    for (const row of report.rows) {
      expect(row.detail).not.toHaveProperty("department");
      expect(row.detail).not.toHaveProperty("concept");
    }
    const second = await createUser(f.db.pool, f.actor, {
      name: "Otro administrador",
      login: randomUUID(),
      password: randomUUID(),
    });
    const restricted = await createUser(f.db.pool, f.actor, {
      name: "Liquidación",
      login: randomUUID(),
      password: randomUUID(),
      role: "settlement",
    });
    const before = await current();
    const race = await Promise.all([
      markIncidentSeen(f.db.pool, f.actor, { key }),
      markIncidentSeen(f.db.pool, second.id, { key }),
    ]);
    expect(race[0]).toEqual(race[1]);
    expect(race[0].seenBy).toBeTruthy();
    expect(await markIncidentSeen(f.db.pool, second.id, { key })).toEqual(
      race[0],
    );
    expect(await current()).toEqual({
      ...before,
      serverTime: expect.any(String),
    });
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int n FROM route_audit WHERE action='incident.seen'",
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      markIncidentSeen(f.db.pool, restricted.id, { key }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      markIncidentSeen(f.db.pool, randomUUID(), { key }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      markIncidentSeen(f.db.pool, f.actor, { key, seenBy: second.id }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      markIncidentSeen(f.db.pool, f.actor, { key: `service:${randomUUID()}` }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      readIncidentAlerts(f.db.pool, restricted.id, new URLSearchParams()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      readIncidentAlerts(
        f.db.pool,
        f.actor,
        new URLSearchParams({ watch: Array(101).fill("1").join(",") }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      board(new URLSearchParams({ section: "bad" })),
    ).rejects.toThrow();
    await expect(
      board(new URLSearchParams({ unseen: "false" })),
    ).rejects.toThrow();
    for (const cursor of [
      "x",
      "a".repeat(513),
      Buffer.from(JSON.stringify({ filterHash: "bad" })).toString("base64url"),
    ])
      await expect(
        board(new URLSearchParams({ cursor })),
      ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(
      (await board(new URLSearchParams({ driverId: f.members[1].driverId })))
        .outsideFilter,
    ).toBe(4);
    expect(
      (
        await board(
          new URLSearchParams({ from: "2026-10-01", to: "2026-10-02" }),
        )
      ).outsideFilter,
    ).toBe(4);
    expect(
      (await board(new URLSearchParams({ unseen: "true" }))).rows,
    ).toHaveLength(4);
    const settings = await Promise.allSettled([
      updateIncidentAlarm(f.db.pool, f.actor, {
        seconds: 10,
        expectedVersion: 1,
      }),
      updateIncidentAlarm(f.db.pool, second.id, {
        seconds: 15,
        expectedVersion: 1,
      }),
    ]);
    expect(settings.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(
      updateIncidentAlarm(f.db.pool, restricted.id, {
        seconds: 5,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ status: 403 });
    for (const seconds of [5, 10, 15]) {
      const value = await readIncidentAlerts(
        f.db.pool,
        f.actor,
        new URLSearchParams(),
      );
      expect(
        await updateIncidentAlarm(f.db.pool, f.actor, {
          seconds,
          expectedVersion: value.settings.version,
        }),
      ).toMatchObject({ seconds });
    }
    const baseline = await readIncidentAlerts(
      f.db.pool,
      f.actor,
      new URLSearchParams(),
    );
    await classifyProductIncident(f.db.pool, f.actor, warehouse.incidentId!, {
      expectedVersion: 1,
      department: "Compras",
      concept: "Error en compra",
      comment: "Corregido por admin",
    });
    expect(
      (await board()).rows.find((row) => row.id === warehouse.incidentId)
        ?.detail.note,
    ).toBe("Corregido por admin");
    expect(
      (
        await readIncidentAlerts(
          f.db.pool,
          f.actor,
          new URLSearchParams({ after: baseline.cursor }),
        )
      ).rows,
    ).toHaveLength(0);
    const rawRoute = (
      await f.db.pool.query(
        "SELECT * FROM route_driver_executions WHERE id=$1",
        [route.id],
      )
    ).rows[0];
    const rawStop = (
      await f.db.pool.query(
        "SELECT * FROM route_driver_execution_stops WHERE id=$1",
        [stop.id],
      )
    ).rows[0];
    const service = await transaction(f.db.pool, (sql) =>
      openDriverCase(
        sql,
        rawRoute,
        rawStop,
        "order_rejected",
        [shipment],
        "Rechazado",
        "other",
        f.timezone,
        f.now,
      ),
    );
    expect(
      (await board()).rows.find((row) => row.id === service)?.detail.note,
    ).toBe("Rechazado");
    await markIncidentSeen(f.db.pool, f.actor, { key: `service:${service}` });
    expect((await board(new URLSearchParams({ section: "late" }))).total).toBe(
      1,
    );
    const late = (await board(new URLSearchParams({ section: "late" })))
      .rows[0];
    expect(late.notification).toBeNull();
    expect(
      (await board(new URLSearchParams({ section: "location" }))).total,
    ).toBe(0);
    // Real insertion trigger, immutable source record, different orders to isolate sequence serialization.
    const clone = `INSERT INTO route_product_incidents(id,execution_id,stop_id,shipment_id,driver_id,visit_sequence,kind,product,unit,quantity,note,order_name,occurred_at,event_date,timezone,snapshot,department,concept)
      SELECT $1,execution_id,$3,$4,driver_id,visit_sequence,kind,product,unit,quantity,note,order_name,occurred_at,event_date,timezone,snapshot,department,concept FROM route_product_incidents WHERE id=$2`;
    const a = await f.db.pool.connect(),
      b = await f.db.pool.connect();
    try {
      await a.query("BEGIN");
      await b.query("BEGIN");
      const first = randomUUID(),
        next = randomUUID(),
        other = route.stops[1];
      await a.query(clone, [first, recorded.incidentId, stop.id, shipment]);
      let finished = false;
      const later = b
        .query(clone, [
          next,
          recorded.incidentId,
          other.id,
          other.shipmentIds[0],
        ])
        .then(() => {
          finished = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(finished).toBe(false);
      const invisible = await readIncidentAlerts(
        f.db.pool,
        f.actor,
        new URLSearchParams({ after: baseline.cursor }),
      );
      expect(invisible.rows).toHaveLength(0); // committed service already seen, both writers still invisible
      await a.query("COMMIT");
      await later;
      await b.query("COMMIT");
      const committed = await readIncidentAlerts(
        f.db.pool,
        f.actor,
        new URLSearchParams({ after: invisible.cursor }),
      );
      expect(committed.rows).toHaveLength(2);
      await a.query("BEGIN");
      await a.query(clone, [
        randomUUID(),
        recorded.incidentId,
        stop.id,
        shipment,
      ]);
      await a.query("ROLLBACK");
      expect(
        (
          await readIncidentAlerts(
            f.db.pool,
            f.actor,
            new URLSearchParams({ after: committed.cursor }),
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await a.query("ROLLBACK");
      await b.query("ROLLBACK");
      a.release();
      b.release();
    }
    const cut = await readIncidentAlerts(
      f.db.pool,
      f.actor,
      new URLSearchParams(),
    );
    for (let i = 0; i < 105; i++)
      await f.db.pool.query(clone, [
        randomUUID(),
        recorded.incidentId,
        stop.id,
        shipment,
      ]);
    const firstPage = await readIncidentAlerts(
      f.db.pool,
      f.actor,
      new URLSearchParams({ after: cut.cursor }),
    );
    expect(firstPage.rows).toHaveLength(100);
    expect(firstPage.more).toBe(true);
    const finalPage = await readIncidentAlerts(
      f.db.pool,
      f.actor,
      new URLSearchParams({ after: firstPage.cursor }),
    );
    expect(finalPage.rows).toHaveLength(5);
    expect(finalPage.more).toBe(false);
    expect(
      (
        await readIncidentAlerts(
          f.db.pool,
          f.actor,
          new URLSearchParams({
            watch: finalPage.rows.map((row) => row.sequence).join(","),
          }),
        )
      ).watching,
    ).toHaveLength(5);
    let page = await board();
    const keys = page.rows.map((row) => row.key);
    expect(page.nextCursor).not.toBeNull();
    await expect(
      board(
        new URLSearchParams({
          cursor: page.nextCursor!,
          driverId: f.members[1].driverId,
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(
      readIncidentBoard(
        f.db.pool,
        restricted.id,
        new URLSearchParams(),
        f.timezone,
      ),
    ).rejects.toMatchObject({ status: 403 });
    while (page.nextCursor) {
      page = await board(new URLSearchParams({ cursor: page.nextCursor }));
      keys.push(...page.rows.map((row) => row.key));
    }
    expect(keys).toHaveLength(114);
    expect(new Set(keys).size).toBe(114);
    await f.start(f.members[1]);
    const secondRoute = await readDriverExecution(
      f.db.pool,
      f.members[1].driverId,
      f.planId,
      f.timezone,
    );
    const secondStop = secondRoute.stops[0];
    const beforeLate = await readIncidentAlerts(
      f.db.pool,
      f.actor,
      new URLSearchParams(),
    );
    await executeStopCommand(
      f.db.pool,
      f.members[1].authorization,
      f.planId,
      secondStop.id,
      "arrival",
      {
        commandId: randomUUID(),
        executionId: secondRoute.id,
        publicationRevision: secondRoute.publicationRevision,
        executionRevision: secondRoute.revision,
        stopVersion: secondStop.version,
        visitSequence: secondStop.visitSequence,
        policyVersion: secondRoute.policy.version,
        sample: {
          latitude: 20.64,
          longitude: -103.4,
          accuracyMeters: 5,
          ageMilliseconds: 0,
          capturedAt: f.now.toISOString(),
          mock: false,
        },
      },
      f.timezone,
      f.now,
    );
    const newLate = (
      await board(new URLSearchParams({ section: "late" }))
    ).rows.find((row) => row.driverId === f.members[1].driverId)!;
    expect(newLate.notification?.seenAt).toBeNull();
    expect(newLate.notification?.sequence).toBeTruthy();
    const silentLate = await readIncidentAlerts(
      f.db.pool,
      f.actor,
      new URLSearchParams({
        after: beforeLate.cursor,
        watch: newLate.notification!.sequence,
      }),
    );
    expect(silentLate.cursor).toBe(newLate.notification!.sequence);
    expect(silentLate.rows).toEqual([]);
    expect(silentLate.watching).toEqual([]);
    // Audible arrivals immediately after a silent one are not skipped by its cursor.
    const afterLate = await capture();
    const mixed = await readIncidentAlerts(
      f.db.pool,
      f.actor,
      new URLSearchParams({ after: beforeLate.cursor }),
    );
    const afterLateSequence = (
      await f.db.pool.query(
        "SELECT sequence::text FROM route_incident_notifications WHERE product_id=$1",
        [afterLate.incidentId],
      )
    ).rows[0].sequence;
    expect(mixed.rows.map((row) => row.sequence)).toEqual([afterLateSequence]);
    await markIncidentSeen(f.db.pool, second.id, { key: newLate.key });
    expect(
      (await board(new URLSearchParams({ section: "late" }))).rows.find(
        (row) => row.key === newLate.key,
      )?.notification?.seenBy,
    ).toBe("Otro administrador");
    const seenTimes: number[] = [];
    for (const pending of (
      await board(new URLSearchParams({ unseen: "true" }))
    ).rows.slice(0, 15)) {
      const start = performance.now();
      await markIncidentSeen(f.db.pool, f.actor, { key: pending.key });
      seenTimes.push(performance.now() - start);
    }
    seenTimes.sort((a, b) => a - b);
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      await board();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    await writeFile(
      ".local/io-board-latency.json",
      JSON.stringify({
        samples: 15,
        rows: (await board()).total,
        p50Ms: times[7],
        p95Ms: times[14],
        seenP50Ms: seenTimes[7],
        seenP95Ms: seenTimes[14],
        environment: "local PostgreSQL sequential reads",
      }),
    );
  } finally {
    await f.close();
  }
}, 60000);
