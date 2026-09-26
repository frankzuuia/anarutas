import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { migrate } from "../src/core/database";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { executeStopCommand, exitDriverVisit } from "../src/core/driver-stop-command";
import { executionFixture } from "./helpers/driver-execution";

it("upgrades a started v20 execution without losing arrival history or its per-order identity", async () => {
  const fixture = await executionFixture();
  const { pool } = fixture.db;
  const driver = fixture.members[0];
  try {
    await fixture.start();
    const before = await readDriverExecution(pool, driver.driverId, fixture.planId, fixture.timezone);
    const stop = before.stops[0];
    const sample = { latitude: 20.64, longitude: -103.4, accuracyMeters: 5,
      ageMilliseconds: 0, capturedAt: fixture.now.toISOString(), mock: false };
    const arrival = await executeStopCommand(pool, driver.authorization, fixture.planId, stop.id, "arrival", {
      commandId: randomUUID(), executionId: before.id, publicationRevision: before.publicationRevision,
      executionRevision: before.revision, stopVersion: stop.version,
      policyVersion: before.policy.version, sample,
    }, fixture.timezone, fixture.now);

    // Restore only the v21 additions inside this isolated database. The real
    // arrival and publication remain in place as a v20 upgrade fixture.
    await pool.query(`
      DROP TABLE route_driver_incident_events,route_driver_incident_orders,
        route_driver_incident_evidence,route_driver_service_incidents CASCADE;
      DROP TABLE route_driver_execution_orders;
      DROP FUNCTION seed_driver_execution_orders() CASCADE;
      DROP TRIGGER preserve_driver_stop_shipments ON route_driver_execution_stops;
      DROP FUNCTION preserve_driver_stop_shipments();
      DROP FUNCTION verify_driver_order_membership();
      DROP INDEX execution_stop_visit_arrival,execution_stop_visit_exit,execution_stop_identity_idx;
      ALTER TABLE route_driver_stop_events
        DROP CONSTRAINT execution_event_visit_sequence,
        DROP CONSTRAINT execution_arrival_has_visit,
        DROP CONSTRAINT execution_exit_has_visit,
        DROP CONSTRAINT route_driver_stop_events_kind_check,
        DROP COLUMN visit_sequence,
        ADD CONSTRAINT route_driver_stop_events_kind_check CHECK(kind IN ('arrival','repoint'));
      CREATE UNIQUE INDEX execution_stop_single_arrival ON route_driver_stop_events(execution_id,stop_id)
        WHERE kind='arrival';
      ALTER TABLE route_driver_execution_stops
        DROP CONSTRAINT execution_stop_visit_state,
        DROP CONSTRAINT execution_stop_visit_sequence,
        DROP CONSTRAINT execution_stop_active_arrival,
        DROP COLUMN visit_state,
        DROP COLUMN visit_sequence;
      UPDATE rutas_installation SET schema_version=20 WHERE singleton=true;
    `);
    await migrate(pool, fixture.db.config.instanceId);
    const upgraded = await readDriverExecution(pool, driver.driverId, fixture.planId, fixture.timezone);
    expect(upgraded.stops[0]).toMatchObject({ visitState: "arrived", visitSequence: 1,
      arrivedAt: fixture.now.toISOString() });
    expect((await pool.query("SELECT visit_sequence FROM route_driver_stop_events WHERE id=$1", [arrival.eventId]))
      .rows[0].visit_sequence).toBe(1);
    const rows = (await pool.query(`SELECT stop_id,shipment_id,status
      FROM route_driver_execution_orders WHERE execution_id=$1`, [upgraded.id])).rows;
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.status === "open")).toBe(true);
    expect(new Set(rows.map(row => row.shipment_id))).toEqual(
      new Set(upgraded.stops.flatMap(item => item.shipmentIds)));
    expect(rows.find(row => row.shipment_id === stop.shipmentIds[0])?.stop_id).toBe(stop.id);
    await expect(pool.query(`INSERT INTO route_driver_execution_orders(execution_id,stop_id,shipment_id)
      VALUES($1,$2,$3)`, [upgraded.id, stop.id, randomUUID()]))
      .rejects.toMatchObject({ code: "23514", message: expect.stringContaining("DRIVER_ORDER_NOT_IN_STOP") });
    await expect(pool.query("UPDATE route_driver_execution_stops SET shipment_ids=ARRAY[$2::uuid] WHERE id=$1",
      [stop.id, randomUUID()])).rejects.toMatchObject({ code: "23514",
        message: expect.stringContaining("DRIVER_STOP_SHIPMENTS_IMMUTABLE") });

    const repeatedArrival = await executeStopCommand(pool, driver.authorization, fixture.planId, stop.id,
      "arrival", { commandId: randomUUID(), executionId: upgraded.id,
        publicationRevision: upgraded.publicationRevision, executionRevision: upgraded.revision,
        stopVersion: upgraded.stops[0].version, policyVersion: upgraded.policy.version, sample },
      fixture.timezone, fixture.now);
    expect(repeatedArrival).toMatchObject({ eventId: arrival.eventId, duplicate: true,
      executionRevision: upgraded.revision });
    expect((await pool.query("SELECT count(*)::int n FROM route_driver_stop_events WHERE stop_id=$1 AND kind='arrival'", [stop.id]))
      .rows[0].n).toBe(1);
    const unchangedRepoint = await executeStopCommand(pool, driver.authorization, fixture.planId, stop.id,
      "repoint", { commandId: randomUUID(), executionId: upgraded.id,
        publicationRevision: upgraded.publicationRevision, executionRevision: upgraded.revision,
        stopVersion: upgraded.stops[0].version, policyVersion: upgraded.policy.version,
        customerLocationVersion: upgraded.stops[0].customerLocationVersion,
        point: { latitude: 20.64, longitude: -103.4 }, sample }, fixture.timezone, fixture.now);
    expect(unchangedRepoint).toMatchObject({ eventId: null, duplicate: false, unchanged: true });

    await pool.query("UPDATE route_driver_execution_orders SET status='closed_pending',version=version+1 WHERE shipment_id=$1", [stop.shipmentIds[0]]);
    await pool.query("UPDATE rutas_installation SET schema_version=20 WHERE singleton=true");
    await migrate(pool, fixture.db.config.instanceId);
    expect((await pool.query("SELECT status,version FROM route_driver_execution_orders WHERE shipment_id=$1", [stop.shipmentIds[0]]))
      .rows[0]).toEqual({ status: "closed_pending", version: 2 });

    // An authenticated, idempotent exit reopens the stop without delivering
    // either shipment, while the immutable first arrival remains in history.
    const exitInput = { commandId: randomUUID(), executionId: upgraded.id,
      publicationRevision: upgraded.publicationRevision, executionRevision: upgraded.revision,
      stopVersion: upgraded.stops[0].version, visitSequence: 1 };
    await expect(exitDriverVisit(pool, "Bearer invalid", fixture.planId, stop.id,
      exitInput, fixture.timezone, fixture.now)).rejects.toMatchObject({ status: 401 });
    for (const invalid of [
      { ...exitInput, commandId: randomUUID(), executionId: randomUUID() },
      { ...exitInput, commandId: randomUUID(), publicationRevision: exitInput.publicationRevision + 1 },
      { ...exitInput, commandId: randomUUID(), executionRevision: exitInput.executionRevision + 1 },
      { ...exitInput, commandId: randomUUID(), stopVersion: exitInput.stopVersion + 1 },
    ]) await expect(exitDriverVisit(pool, driver.authorization, fixture.planId, stop.id,
      invalid, fixture.timezone, fixture.now)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(exitDriverVisit(pool, driver.authorization, fixture.planId, randomUUID(),
      { ...exitInput, commandId: randomUUID() }, fixture.timezone, fixture.now))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(exitDriverVisit(pool, driver.authorization, fixture.planId, stop.id,
      { ...exitInput, commandId: randomUUID(), visitSequence: 2 }, fixture.timezone, fixture.now))
      .rejects.toMatchObject({ code: "VISIT_NOT_ACTIVE" });
    expect((await pool.query("SELECT count(*)::int n FROM route_driver_stop_events WHERE kind='visit_exit'", [])).rows[0].n).toBe(0);
    const exited = await exitDriverVisit(pool, driver.authorization, fixture.planId, stop.id,
      exitInput, fixture.timezone, fixture.now);
    expect(exited).toMatchObject({ duplicate: false, executionRevision: upgraded.revision + 1 });
    expect(await exitDriverVisit(pool, driver.authorization, fixture.planId, stop.id,
      exitInput, fixture.timezone, fixture.now)).toMatchObject({ eventId: exited.eventId, duplicate: true });
    await expect(exitDriverVisit(pool, driver.authorization, fixture.planId, stop.id,
      { ...exitInput, stopVersion: exitInput.stopVersion + 1 }, fixture.timezone, fixture.now))
      .rejects.toMatchObject({ code: "COMMAND_REUSED" });
    expect((await pool.query("SELECT status FROM route_driver_execution_orders WHERE shipment_id=$1", [stop.shipmentIds[0]]))
      .rows[0].status).toBe("closed_pending");
    const opened = await readDriverExecution(pool, driver.driverId, fixture.planId, fixture.timezone);
    expect(opened.stops[0]).toMatchObject({ visitState: "open", visitSequence: 1, arrivedAt: null });
    await expect(exitDriverVisit(pool, driver.authorization, fixture.planId, stop.id,
      { ...exitInput, commandId: randomUUID(), executionRevision: opened.revision,
        stopVersion: opened.stops[0].version }, fixture.timezone, fixture.now))
      .rejects.toMatchObject({ code: "VISIT_NOT_ACTIVE" });
    await expect(pool.query("UPDATE route_driver_stop_events SET kind='repoint' WHERE id=$1", [arrival.eventId]))
      .rejects.toThrow("DRIVER_EVENT_IMMUTABLE");
    const second = await executeStopCommand(pool, driver.authorization, fixture.planId, stop.id, "arrival", {
      commandId: randomUUID(), executionId: opened.id, publicationRevision: opened.publicationRevision,
      executionRevision: opened.revision, stopVersion: opened.stops[0].version,
      policyVersion: opened.policy.version, sample,
    }, fixture.timezone, fixture.now);
    expect(second.eventId).not.toBe(arrival.eventId);
    expect((await readDriverExecution(pool, driver.driverId, fixture.planId, fixture.timezone)).stops[0])
      .toMatchObject({ visitState: "arrived", visitSequence: 2 });
    expect((await pool.query("SELECT visit_sequence FROM route_driver_stop_events WHERE stop_id=$1 AND kind='arrival' ORDER BY visit_sequence", [stop.id]))
      .rows.map(row => row.visit_sequence)).toEqual([1, 2]);
    const beforeSwitch = await readDriverExecution(pool, driver.driverId, fixture.planId, fixture.timezone);
    const nextStop = beforeSwitch.stops[1];
    const switchInput = { commandId: randomUUID(), executionId: beforeSwitch.id,
      publicationRevision: beforeSwitch.publicationRevision, executionRevision: beforeSwitch.revision,
      stopVersion: nextStop.version, policyVersion: beforeSwitch.policy.version, sample };
    await expect(executeStopCommand(pool, driver.authorization, fixture.planId, nextStop.id,
      "arrival", { ...switchInput, sample: { ...sample, latitude: 21 } }, fixture.timezone, fixture.now))
      .rejects.toMatchObject({ code: "OUTSIDE_ARRIVAL_RADIUS" });
    expect((await readDriverExecution(pool, driver.driverId, fixture.planId, fixture.timezone)).stops[0].visitState)
      .toBe("arrived");
    await executeStopCommand(pool, driver.authorization, fixture.planId, nextStop.id,
      "arrival", switchInput, fixture.timezone, fixture.now);
    const switched = await readDriverExecution(pool, driver.driverId, fixture.planId, fixture.timezone);
    expect(switched.stops[0]).toMatchObject({ visitState: "open", arrivedAt: null, visitSequence: 2 });
    expect(switched.stops[1]).toMatchObject({ visitState: "arrived", visitSequence: 1 });
    expect((await pool.query("SELECT details FROM route_driver_stop_events WHERE stop_id=$1 AND kind='visit_exit' ORDER BY occurred_at DESC,id DESC", [stop.id]))
      .rows.some(row => row.details.reason === "new_arrival")).toBe(true);
  } finally { await fixture.close(); }
}, 120_000);
