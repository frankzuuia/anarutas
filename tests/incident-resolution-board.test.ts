import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, it } from "vitest";
import { executionFixture } from "./helpers/driver-execution";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand } from "../src/core/driver-stop-command";
import {
  reportProductIncident,
  resolveProductIncident,
  classifyProductIncident,
} from "../src/core/product-incidents";
import {
  reportProductIncidentWithPhotos,
  readProductIncidentEvidence,
} from "../src/core/product-incidents-evidence";
import {
  readIncidentBoard,
  readIncidentAlerts,
  markIncidentSeen,
} from "../src/core/incident-board";
import { createUser } from "../src/core/auth";
import { cancelProductIncidentByAdmin } from "../src/core/product-incident-admin-cancel";
import { transaction } from "../src/core/database";
import { openDriverCase } from "../src/core/driver-service-cases";
import { resolveLiveIncident } from "../src/core/driver-live-incidents";
import { cancelPublishedRoute } from "../src/core/route-publications";

it("resolved records have independent authorized pages, notes, shared seen and no new alarms or financial writes", async () => {
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
    const stopId = route.stops[0].id,
      shipmentId = route.stops[0].shipmentIds[0];
    const identity = async () => {
      route = await current();
      const stop = route.stops[0];
      return {
        commandId: randomUUID(),
        executionId: route.id,
        publicationRevision: route.publicationRevision,
        executionRevision: route.revision,
        stopVersion: stop.version,
        visitSequence: stop.visitSequence,
        orderVersion: stop.orderStates[0].version,
        policyVersion: route.policy.version,
      };
    };
    await executeStopCommand(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stopId,
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
    const bytes = await sharp({
      create: { width: 24, height: 24, channels: 3, background: "#518760" },
    })
      .jpeg()
      .toBuffer();
    const captured = await reportProductIncidentWithPhotos(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stopId,
      shipmentId,
      {
        ...(await identity()),
        formVersion: 3,
        kind: "replacement_quality",
        lineIndex: 0,
        quantity: "0.25",
        department: "Compras",
        concept: "Error en compra",
        comments: ["customer_specifications"],
      },
      f.timezone,
      [{ bytes, contentType: "image/jpeg" }],
      f.photoRoot,
      f.now,
    );
    const id = captured.incidentId!;
    await reportProductIncident(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stopId,
      shipmentId,
      {
        ...(await identity()),
        formVersion: 3,
        kind: "shortage_validation",
        product: "Faltante independiente",
        unit: "kg",
        quantity: "1",
        department: "Compras",
        concept: "Error en compra",
        comments: ["product_not_ordered"],
      },
      f.timezone,
      f.now,
    );
    const board = (params = new URLSearchParams({ section: "resolved" })) =>
      readIncidentBoard(f.db.pool, f.actor, params, f.timezone);
    const previous = (
      await f.db.pool.query(
        "SELECT * FROM route_driver_execution_orders WHERE execution_id=$1 ORDER BY shipment_id",
        [route.id],
      )
    ).rows;
    const baseline = await readIncidentAlerts(
      f.db.pool,
      f.actor,
      new URLSearchParams(),
    );
    const sequence = (
      await readIncidentBoard(
        f.db.pool,
        f.actor,
        new URLSearchParams(),
        f.timezone,
      )
    ).rows.find((row) => row.id === id)!.notification!.sequence;
    await resolveProductIncident(f.db.pool, f.actor, id, {
      expectedVersion: 1,
      note: "Reposición entregada\nConfirmada por administración",
    });
    expect((await board()).rows).toMatchObject([
      {
        id,
        status: "resolved",
        detail: {
          canResolve: false,
          resolutionNote: "Reposición entregada\nConfirmada por administración",
          photos: expect.any(Array),
        },
      },
    ]);
    expect(
      (
        await readIncidentBoard(
          f.db.pool,
          f.actor,
          new URLSearchParams(),
          f.timezone,
        )
      ).rows.some((row) => row.id === id),
    ).toBe(false);
    expect(
      (
        await f.db.pool.query(
          "SELECT * FROM route_driver_execution_orders WHERE execution_id=$1 ORDER BY shipment_id",
          [route.id],
        )
      ).rows,
    ).toEqual(previous);
    expect(
      (
        await f.db.pool.query(
          "SELECT count(*)::int n FROM route_odoo_return_jobs",
        )
      ).rows[0].n,
    ).toBe(0);
    const alerts = await readIncidentAlerts(
      f.db.pool,
      f.actor,
      new URLSearchParams({ after: baseline.cursor, watch: sequence }),
    );
    expect(alerts).toMatchObject({
      rows: [],
      watching: [],
      cursor: baseline.cursor,
    });
    await readProductIncidentEvidence(f.db.pool, f.actor, id, f.photoRoot);
    const second = await createUser(f.db.pool, f.actor, {
      name: "Otro administrador",
      login: randomUUID(),
      password: randomUUID(),
    });
    const seen = await markIncidentSeen(f.db.pool, second.id, {
      key: `product:${id}`,
    });
    expect(seen.seenBy).toBe("Otro administrador");
    expect(
      await markIncidentSeen(f.db.pool, f.actor, { key: `product:${id}` }),
    ).toEqual(seen);
    expect(
      (
        await board(
          new URLSearchParams({ section: "resolved", unseen: "true" }),
        )
      ).total,
    ).toBe(0);
    expect((await board()).rows[0].notification).toEqual(seen);
    await classifyProductIncident(f.db.pool, f.actor, id, {
      expectedVersion: 2,
      department: "Ventas",
      concept: "Reparto",
      comment: "Comentario corregido\nDetalle completo",
    });
    expect((await board()).rows[0].detail.note).toBe(
      "Comentario corregido\nDetalle completo",
    );
    expect((await board()).rows[0].detail.resolutionNote).toBe(
      "Reposición entregada\nConfirmada por administración",
    );
    const restricted = await createUser(f.db.pool, f.actor, {
      name: "Liquidación",
      login: randomUUID(),
      password: randomUUID(),
      role: "settlement",
    });
    await expect(
      readIncidentBoard(
        f.db.pool,
        restricted.id,
        new URLSearchParams({ section: "resolved" }),
        f.timezone,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      readIncidentBoard(
        f.db.pool,
        randomUUID(),
        new URLSearchParams({ section: "resolved" }),
        f.timezone,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (
        await board(
          new URLSearchParams({
            section: "resolved",
            driverId: f.members[1].driverId,
          }),
        )
      ).total,
    ).toBe(0);
    expect(
      (
        await board(
          new URLSearchParams({
            section: "resolved",
            from: "2000-01-01",
            to: "2000-01-02",
          }),
        )
      ).total,
    ).toBe(0);
    for (let index = 0; index < 51; index++) {
      const extra = await reportProductIncidentWithPhotos(
        f.db.pool,
        f.members[0].authorization,
        f.planId,
        stopId,
        shipmentId,
        {
          ...(await identity()),
          formVersion: 3,
          kind: "replacement_quality",
          lineIndex: 0,
          quantity: "0.01",
          department: "Compras",
          concept: "Error en compra",
          comments: ["customer_specifications"],
        },
        f.timezone,
        [{ bytes, contentType: "image/jpeg" }],
        f.photoRoot,
        f.now,
      );
      await resolveProductIncident(f.db.pool, f.actor, extra.incidentId!, {
        expectedVersion: 1,
        note: "Reposición atendida",
      });
    }
    const first = await board();
    expect(first.total).toBe(52);
    expect(first.rows).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const last = await board(
      new URLSearchParams({ section: "resolved", cursor: first.nextCursor! }),
    );
    expect(last.rows).toHaveLength(2);
    expect(last.nextCursor).toBeNull();
    expect(
      new Set([...first.rows, ...last.rows].map((row) => row.key)).size,
    ).toBe(52);
    await expect(
      board(
        new URLSearchParams({ section: "routes", cursor: first.nextCursor! }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(
      board(
        new URLSearchParams({
          section: "resolved",
          driverId: f.members[1].driverId,
          cursor: first.nextCursor!,
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    const plan = (
      await f.db.pool.query("SELECT version FROM route_plans WHERE id=$1", [
        f.planId,
      ])
    ).rows[0];
    await cancelPublishedRoute(
      f.db.pool,
      f.actor,
      f.planId,
      f.members[0].vehicleId,
      {
        expectedVersion: plan.version,
        expectedRevision: route.publicationRevision,
      },
    );
    const orderBeforeRemoval = (
      await f.db.pool.query(
        "SELECT * FROM route_driver_execution_orders WHERE execution_id=$1 ORDER BY shipment_id",
        [route.id],
      )
    ).rows;
    await cancelProductIncidentByAdmin(f.db.pool, f.actor, id, {
      expectedVersion: 3,
    });
    expect(
      (
        await f.db.pool.query(
          "SELECT status,report_removed_at IS NOT NULL removed FROM route_product_incidents WHERE id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({ status: "resolved", removed: true });
    expect(
      (
        await f.db.pool.query(
          "SELECT * FROM route_driver_execution_orders WHERE execution_id=$1 ORDER BY shipment_id",
          [route.id],
        )
      ).rows,
    ).toEqual(orderBeforeRemoval);
    expect((await board()).total).toBe(51);
    await expect(
      markIncidentSeen(f.db.pool, f.actor, { key: `product:${id}` }),
    ).rejects.toMatchObject({ status: 404 });
    const durations: number[] = [];
    for (let index = 0; index < 15; index++) {
      const start = performance.now();
      await board();
      durations.push(performance.now() - start);
    }
    durations.sort((a, b) => a - b);
    await writeFile(
      ".local/incident-resolution-performance.json",
      JSON.stringify(
        {
          samples: 15,
          rows: 51,
          p50Ms: durations[7],
          p95Ms: durations[14],
          environment: "isolated PostgreSQL, not production",
        },
        null,
        2,
      ),
    );
  } finally {
    await f.close();
  }
});

it("administratively resolved service cases move to the same section without duplicating shared seen", async () => {
  const f = await executionFixture();
  try {
    await f.start();
    const route = await readDriverExecution(
      f.db.pool,
      f.members[0].driverId,
      f.planId,
      f.timezone,
    );
    const stop = route.stops[0];
    await executeStopCommand(
      f.db.pool,
      f.members[0].authorization,
      f.planId,
      stop.id,
      "arrival",
      {
        commandId: randomUUID(),
        executionId: route.id,
        publicationRevision: route.publicationRevision,
        executionRevision: route.revision,
        stopVersion: stop.version,
        policyVersion: route.policy.version,
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
    const id = await transaction(f.db.pool, (sql) =>
      openDriverCase(
        sql,
        rawRoute,
        rawStop,
        "order_rejected",
        stop.shipmentIds,
        "Pedido rechazado",
        "other",
        f.timezone,
        f.now,
      ),
    );
    const board = (section: string) =>
      readIncidentBoard(
        f.db.pool,
        f.actor,
        new URLSearchParams({ section }),
        f.timezone,
      );
    expect((await board("routes")).rows.some((row) => row.id === id)).toBe(
      true,
    );
    expect((await board("resolved")).total).toBe(0);
    const before = await readIncidentAlerts(
      f.db.pool,
      f.actor,
      new URLSearchParams(),
    );
    await resolveLiveIncident(
      f.db.pool,
      f.actor,
      id,
      { expectedVersion: 1 },
      f.now,
    );
    expect((await board("routes")).rows.some((row) => row.id === id)).toBe(
      false,
    );
    expect((await board("resolved")).rows).toMatchObject([
      {
        id,
        status: "resolved_by_admin",
        detail: { canResolve: false, note: "Pedido rechazado" },
      },
    ]);
    const seen = await markIncidentSeen(f.db.pool, f.actor, {
      key: `service:${id}`,
    });
    expect((await board("resolved")).rows[0].notification).toEqual(seen);
    expect(
      (
        await readIncidentAlerts(
          f.db.pool,
          f.actor,
          new URLSearchParams({ after: before.cursor }),
        )
      ).rows,
    ).toEqual([]);
    // The real delivery transition is a different status; it must not be mislabeled as an admin resolution.
    await f.db.pool.query(
      "UPDATE route_driver_service_incidents SET status='completed',admin_resolved_by=NULL,version=version+1 WHERE id=$1",
      [id],
    );
    expect((await board("resolved")).total).toBe(0);
  } finally {
    await f.close();
  }
});
