import type { Pool } from "pg";
import { transaction, assertActiveActor, audit } from "./database";
import { authenticateMobile } from "./driver-mobile-auth";
import { executableRoute } from "./driver-execution-read";
import { AppError } from "./errors";
import { integer, uuid } from "./orders-validation";
import { controlScreens, trackingIdentity, trackingPolicy, trackingSample } from "./live-tracking-policy";
import { trackingEta } from "./live-eta-validation";

export async function writeLiveTracking(pool: Pool, authorization: string | null, planId: string, raw: Record<string, unknown>) {
  const identity = trackingIdentity(raw);
  if (!["begin", "sample", "stop"].includes(raw.kind as string)) throw new AppError("INVALID_INPUT");
  const sequence = raw.kind === "begin" ? 0 : integer(raw.sequence, 1);
  const sample = raw.kind === "sample" ? trackingSample(raw.sample) : null;
  const target = raw.kind === "sample" && raw.targetStopId !== null ? uuid(raw.targetStopId) : null;
  return transaction(pool, async sql => {
    const driver = await authenticateMobile(sql, authorization, true);
    const route = await executableRoute(sql, driver.driver_id, planId, true);
    if (route.id !== identity.executionId || route.publication_revision !== identity.publicationRevision)
      throw new AppError("TRACKING_SESSION_CHANGED", 409);
    const now = new Date();
    const eta = raw.kind === "sample" ? trackingEta(raw.eta, target, now) : null;
    const current = (await sql.query("SELECT * FROM route_live_tracking WHERE execution_id=$1 FOR UPDATE", [route.id])).rows[0];
    if (raw.kind === "begin") {
      const previous = (await sql.query("SELECT * FROM route_tracking_sessions WHERE id=$1", [identity.sessionId])).rows[0];
      if (previous) {
        if (previous.execution_id !== route.id || previous.device_id !== driver.device_id || current?.session_id !== identity.sessionId || current.stopped)
          throw new AppError("TRACKING_SESSION_CHANGED", 409);
      } else {
        await sql.query("INSERT INTO route_tracking_sessions(id,execution_id,device_id) VALUES($1,$2,$3)", [identity.sessionId, route.id, driver.device_id]);
        await sql.query(`INSERT INTO route_live_tracking(execution_id,session_id,device_id) VALUES($1,$2,$3)
          ON CONFLICT(execution_id) DO UPDATE SET session_id=$2,device_id=$3,sequence=0,target_stop_id=NULL,eta=NULL,
          latitude=NULL,longitude=NULL,accuracy_meters=NULL,observed_at=NULL,received_at=now(),stopped=false`, [route.id, identity.sessionId, driver.device_id]);
        await sql.query("INSERT INTO route_driver_mobile_audit(driver_id,action,details) VALUES($1,'tracking.started',$2)",
          [driver.driver_id, JSON.stringify({ executionId: route.id, sessionId: identity.sessionId })]);
      }
      return { accepted: true, ...trackingPolicy };
    }
    if (!current || current.session_id !== identity.sessionId || current.device_id !== driver.device_id || current.stopped)
      throw new AppError("TRACKING_SESSION_CHANGED", 409);
    if (sequence <= Number(current.sequence)) return { accepted: false, ...trackingPolicy };
    if (target) {
      const stop = await sql.query("SELECT id FROM route_driver_execution_stops WHERE execution_id=$1 AND id=$2", [route.id, target]);
      if (!stop.rowCount) throw new AppError("INVALID_TRACKING_TARGET");
    }
    const observed = sample ? new Date(now.getTime() - sample.age) : null;
    // Heartbeats/older GPS may change the destination, but never rejuvenate old coordinates.
    const newer = sample && observed && (!current.observed_at || observed > current.observed_at);
    await sql.query(`UPDATE route_live_tracking SET sequence=$2,target_stop_id=$3,received_at=$4,stopped=$5,
      latitude=$6,longitude=$7,accuracy_meters=$8,observed_at=$9,eta=$10 WHERE execution_id=$1`,
    [route.id, sequence, target, now, raw.kind === "stop", newer ? sample!.latitude : current.latitude,
      newer ? sample!.longitude : current.longitude, newer ? sample!.accuracy : current.accuracy_meters,
      newer ? observed : current.observed_at, eta === null ? null : JSON.stringify(eta)]);
    return { accepted: true, ...trackingPolicy };
  });
}

export async function readControlLayout(pool: Pool, actor: string) {
  return transaction(pool, async sql => {
    await assertActiveActor(sql, actor);
    const row = (await sql.query("SELECT screens,version FROM route_control_layouts WHERE user_id=$1", [actor])).rows[0];
    return row ?? { screens: null, version: 0 };
  });
}
export async function saveControlLayout(pool: Pool, actor: string, raw: Record<string, unknown>) {
  const screens = controlScreens(raw.screens), version = integer(raw.expectedVersion);
  return transaction(pool, async sql => {
    await assertActiveActor(sql, actor);
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`control-layout:${actor}`]);
    const row = (await sql.query("SELECT version FROM route_control_layouts WHERE user_id=$1 FOR UPDATE", [actor])).rows[0];
    if ((row?.version ?? 0) !== version) throw new AppError("VERSION_CONFLICT", 409);
    await sql.query(`INSERT INTO route_control_layouts(user_id,screens) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET screens=$2,version=route_control_layouts.version+1,updated_at=now()`, [actor, JSON.stringify(screens)]);
    await audit(sql, actor, "control.layout.saved", actor, { screens: screens.length });
    return { screens, version: version + 1 };
  });
}
