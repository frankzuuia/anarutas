import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { migrate, transaction } from "../src/core/database";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executionFixture } from "./helpers/driver-execution";

it("keeps live-case, order and 24-hour evidence identity atomic in real PostgreSQL", async () => {
  const fixture = await executionFixture();
  const { pool } = fixture.db;
  try {
    await fixture.start();
    const route = await readDriverExecution(pool, fixture.members[0].driverId,
      fixture.planId, fixture.timezone);
    const stop = route.stops[0];
    const otherStop = route.stops[1];
    const incidentId = randomUUID();
    const evidenceId = randomUUID();
    const base = [incidentId, route.id, stop.id, fixture.members[0].driverId,
      fixture.now, "2026-09-24", fixture.timezone,
      JSON.stringify({ customer: stop.customer, address: stop.address })];

    await expect(pool.query(`INSERT INTO route_driver_service_incidents
      (id,execution_id,stop_id,driver_id,kind,visit_sequence,occurred_at,event_date,timezone,snapshot)
      VALUES($1,$2,$3,$4,'customer_closed',1,$5,$6,$7,$8)`, base))
      .rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(`INSERT INTO route_driver_service_incidents
      (id,execution_id,stop_id,driver_id,kind,reason_code,note,visit_sequence,
       occurred_at,event_date,timezone,snapshot)
      VALUES($1,$2,$3,$4,'order_rejected','other',' ',1,$5,$6,$7,$8)`, base))
      .rejects.toMatchObject({ code: "23514" });
    await expect(transaction(pool, async sql => {
      await sql.query(`INSERT INTO route_driver_service_incidents
        (id,execution_id,stop_id,driver_id,kind,reason_code,visit_sequence,
         occurred_at,event_date,timezone,snapshot)
        VALUES($1,$2,$3,$4,'order_rejected','poor_quality',1,$5,$6,$7,$8)`,
      [randomUUID(),...base.slice(1)]);
    })).rejects.toMatchObject({ code: "23514",
      message: expect.stringContaining("DRIVER_INCIDENT_WITHOUT_ORDERS") });
    await expect(pool.query(`INSERT INTO route_driver_service_incidents
      (id,execution_id,stop_id,driver_id,kind,reason_code,visit_sequence,
       occurred_at,event_date,timezone,snapshot)
      VALUES($1,$2,$3,$4,'order_rejected','poor_quality',1,$5,$6,$7,$8)`,
    [randomUUID(),route.id,stop.id,fixture.members[1].driverId,fixture.now,
      "2026-09-24",fixture.timezone,"{}"])).rejects.toMatchObject({ code: "23503" });

    // A deferred composite FK permits the circular incident/evidence insert,
    // then verifies that the photo actually belongs to this exact case.
    await transaction(pool, async sql => {
      await sql.query(`INSERT INTO route_driver_service_incidents
        (id,execution_id,stop_id,driver_id,kind,visit_sequence,occurred_at,
         event_date,timezone,snapshot,evidence_id)
        VALUES($1,$2,$3,$4,'customer_closed',1,$5,$6,$7,$8,$9)`, [...base,evidenceId]);
      await sql.query(`INSERT INTO route_driver_incident_evidence
        (id,incident_id,storage_key,content_hash,bytes,created_at,expires_at)
        VALUES($1,$2,$3,$4,100,$5,$5::timestamptz+interval '24 hours')`,
      [evidenceId,incidentId,`${evidenceId}.webp`,"a".repeat(64),fixture.now]);
      await sql.query(`INSERT INTO route_driver_incident_orders
        (incident_id,execution_id,stop_id,shipment_id) VALUES($1,$2,$3,$4)`,
      [incidentId,route.id,stop.id,stop.shipmentIds[0]]);
      await sql.query(`INSERT INTO route_driver_incident_events
        (id,incident_id,kind,actor_type,actor_driver_id,occurred_at)
        VALUES($1,$2,'opened','driver',$3,$4)`,
      [randomUUID(),incidentId,fixture.members[0].driverId,fixture.now]);
    });
    expect((await pool.query(`SELECT i.kind,e.expires_at-e.created_at AS lifetime
      FROM route_driver_service_incidents i
      JOIN route_driver_incident_evidence e ON e.id=i.evidence_id
      WHERE i.id=$1`, [incidentId])).rows[0]).toMatchObject({
      kind: "customer_closed", lifetime: { days: 1 },
    });
    await expect(pool.query(`INSERT INTO route_driver_incident_evidence
      (id,incident_id,storage_key,content_hash,bytes,created_at,expires_at)
      VALUES($1,$2,$3,$4,100,$5,$5::timestamptz+interval '25 hours')`,
    [randomUUID(),incidentId,`${randomUUID()}.webp`,"b".repeat(64),fixture.now]))
      .rejects.toMatchObject({ code: "23514" });

    await expect(transaction(pool, async sql => {
      const id = randomUUID();
      await sql.query(`INSERT INTO route_driver_service_incidents
        (id,execution_id,stop_id,driver_id,kind,visit_sequence,occurred_at,
         event_date,timezone,snapshot,evidence_id)
        VALUES($1,$2,$3,$4,'customer_closed',1,$5,$6,$7,$8,$9)`,
      [id,...base.slice(1),randomUUID()]);
    })).rejects.toMatchObject({ code: "23503" });
    expect((await pool.query("SELECT count(*)::int n FROM route_driver_service_incidents")).rows[0].n).toBe(1);

    await expect(pool.query(`INSERT INTO route_driver_incident_orders
      (incident_id,execution_id,stop_id,shipment_id) VALUES($1,$2,$3,$4)`,
    [incidentId,route.id,stop.id,otherStop.shipmentIds[0]]))
      .rejects.toMatchObject({ code: "23503" });
    await expect(pool.query("DELETE FROM route_driver_incident_orders WHERE incident_id=$1", [incidentId]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(pool.query("UPDATE route_driver_incident_orders SET shipment_id=$2 WHERE incident_id=$1",
      [incidentId,otherStop.shipmentIds[0]])).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query(`UPDATE route_driver_service_incidents
      SET status='resolved_by_admin',terminal_at=now(),admin_resolved_by=$2 WHERE id=$1`,
    [incidentId,fixture.actor])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE route_driver_service_incidents SET note='altered' WHERE id=$1", [incidentId]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(pool.query("DELETE FROM route_driver_service_incidents WHERE id=$1", [incidentId]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(pool.query("UPDATE route_driver_incident_evidence SET expires_at=expires_at+interval '24 hours' WHERE id=$1",
      [evidenceId])).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query("UPDATE route_driver_incident_evidence SET content_hash=$2 WHERE id=$1",
      [evidenceId,"b".repeat(64)])).rejects.toMatchObject({ code: "42501" });
    await pool.query("UPDATE route_driver_incident_evidence SET revoked_at=now() WHERE id=$1", [evidenceId]);
    await expect(pool.query("UPDATE route_driver_incident_evidence SET revoked_at=NULL WHERE id=$1", [evidenceId]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(pool.query(`UPDATE route_driver_incident_events SET kind='handled' WHERE incident_id=$1`,
    [incidentId])).rejects.toMatchObject({ code: "42501" });

    // A second valid case may exist historically, but not two simultaneously
    // open cases for the same order, even if writers race.
    const secondId = randomUUID();
    await expect(transaction(pool, async sql => {
      await sql.query(`INSERT INTO route_driver_service_incidents
        (id,execution_id,stop_id,driver_id,kind,reason_code,visit_sequence,
         occurred_at,event_date,timezone,snapshot)
        VALUES($1,$2,$3,$4,'order_rejected','poor_quality',1,$5,$6,$7,$8)`,
      [secondId,...base.slice(1)]);
      await sql.query(`INSERT INTO route_driver_incident_orders
        (incident_id,execution_id,stop_id,shipment_id) VALUES($1,$2,$3,$4)`,
      [secondId,route.id,stop.id,stop.shipmentIds[0]]);
    })).rejects.toMatchObject({ code: "23505" });
    expect((await pool.query("SELECT count(*)::int n FROM route_driver_service_incidents")).rows[0].n).toBe(1);

    await pool.query("UPDATE rutas_installation SET schema_version=21 WHERE singleton=true");
    await migrate(pool, fixture.db.config.instanceId);
    expect((await pool.query("SELECT schema_version FROM rutas_installation WHERE singleton=true"))
      .rows[0].schema_version).toBe(23);
    expect((await pool.query("SELECT count(*)::int n FROM route_driver_service_incidents WHERE id=$1", [incidentId]))
      .rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int n FROM route_driver_incident_events WHERE incident_id=$1", [incidentId]))
      .rows[0].n).toBe(1);
  } finally { await fixture.close(); }
}, 120_000);

it("requires customer-closed evidence to cover every order at a shared stop", async () => {
  const fixture = await executionFixture({ groupFourthOrderWithFirst: true });
  const { pool } = fixture.db;
  try {
    await fixture.start();
    const route = await readDriverExecution(pool, fixture.members[0].driverId,
      fixture.planId, fixture.timezone);
    const shared = route.stops.find(stop => stop.shipmentIds.length === 2);
    expect(shared).toBeDefined();
    const stop = shared!;
    const incidentId = randomUUID();
    const evidenceId = randomUUID();
    await expect(transaction(pool, async sql => {
      await sql.query(`INSERT INTO route_driver_service_incidents
        (id,execution_id,stop_id,driver_id,kind,visit_sequence,event_date,
         timezone,snapshot,evidence_id)
        VALUES($1,$2,$3,$4,'customer_closed',1,'2026-09-24',$5,'{}',$6)`,
      [incidentId,route.id,stop.id,fixture.members[0].driverId,fixture.timezone,evidenceId]);
      await sql.query(`INSERT INTO route_driver_incident_evidence
        (id,incident_id,storage_key,content_hash,bytes)
        VALUES($1,$2,$3,$4,100)`,
      [evidenceId,incidentId,`${evidenceId}.webp`,"c".repeat(64)]);
      await sql.query(`INSERT INTO route_driver_incident_orders
        (incident_id,execution_id,stop_id,shipment_id) VALUES($1,$2,$3,$4)`,
      [incidentId,route.id,stop.id,stop.shipmentIds[0]]);
    })).rejects.toMatchObject({ code: "23514",
      message: expect.stringContaining("DRIVER_CLOSED_INCIDENT_INCOMPLETE") });
    expect((await pool.query("SELECT count(*)::int n FROM route_driver_service_incidents")).rows[0].n).toBe(0);
  } finally { await fixture.close(); }
}, 120_000);
