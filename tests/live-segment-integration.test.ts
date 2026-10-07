import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { executionFixture } from "./helpers/driver-execution";
import { readDriverExecution } from "../src/core/driver-execution-read";
import { readLiveRoutes } from "../src/core/live-routes";
import { writeLiveTracking } from "../src/core/live-tracking";
import { readSegmentEstimate } from "../src/core/live-segment";
import { createUser, setUserActive } from "../src/core/auth";
import { requestSegmentRoadTime } from "../src/core/live-segment-google";

let f: Awaited<ReturnType<typeof executionFixture>>;
let execution: Awaited<ReturnType<typeof readDriverExecution>>;
let identity: { executionId:string; publicationRevision:number; sessionId:string };
let sequence=0;
beforeAll(async()=>{
  f=await executionFixture({orderCount:6,legacyUnloadingSnapshot:true,now:new Date()}); await f.start(); await f.start(f.members[1]);
  execution=await readDriverExecution(f.db.pool,f.members[0].driverId,f.planId,f.timezone);
  identity={executionId:execution.id,publicationRevision:execution.publicationRevision,sessionId:randomUUID()};
  await f.db.pool.query("UPDATE route_customers SET unloading_minutes=10");
  await writeLiveTracking(f.db.pool,f.members[0].authorization,f.planId,{...identity,kind:"begin"});
},120000);
afterAll(async()=>{await f?.close();});
async function sample(index=1,ageMilliseconds=0) {
  return writeLiveTracking(f.db.pool,f.members[0].authorization,f.planId,{...identity,kind:"sample",sequence:++sequence,
    targetStopId:execution.stops[index].id,sample:{latitude:20.64,longitude:-103.4,accuracyMeters:5,ageMilliseconds,mock:false}});
}
function selection() { return {executionId:execution.id,fromStopId:execution.stops[1].id,toStopId:execution.stops[4].id,fromCurrent:true}; }
async function businessState() {
  return (await f.db.pool.query(`SELECT (SELECT jsonb_agg(e ORDER BY e.id) FROM route_driver_executions e) AS execution,
    (SELECT jsonb_agg(s ORDER BY s.id) FROM route_driver_execution_stops s) AS stops,
    (SELECT jsonb_agg(o ORDER BY o.shipment_id) FROM route_driver_execution_orders o) AS orders`)).rows;
}
it("preserves legacy publication manual unloads, coalesces concurrent estimates and follows the driver",async()=>{
  await sample(); const before=await businessState();
  const start=performance.now();
  const results=await Promise.all(Array.from({length:12},()=>readSegmentEstimate(f.db.pool,f.actor,selection())));
  const first=results[0]; expect(first).toMatchObject({positions:[2,3,4,5],travelSeconds:0,serviceSeconds:1800,totalSeconds:1800,unknownServiceStops:0});
  for(const r of results) expect(r).toBe(first);
  expect(await businessState()).toEqual(before);
  await sample(2);
  const advanced=await readSegmentEstimate(f.db.pool,f.actor,selection()); expect(advanced.positions).toEqual([3,4,5]); expect(advanced.totalSeconds).toBe(1200);
  await f.db.pool.query("UPDATE route_customers SET unloading_minutes=7");
  const updated=await readSegmentEstimate(f.db.pool,f.actor,selection()); expect(updated.totalSeconds).toBe(840); expect(updated.contextKey).not.toBe(advanced.contextKey);
  await sample(4); expect((await readSegmentEstimate(f.db.pool,f.actor,selection())).totalSeconds).toBe(0);
  console.log(JSON.stringify({check:"segment-real-pg-concurrency",requests:12,milliseconds:Math.round(performance.now()-start),businessMutations:0}));
});
it("rejects wrong execution/stop, revoked account and settlement role even with a cached result",async()=>{
  await sample(); await readSegmentEstimate(f.db.pool,f.actor,selection());
  const foreign=await readDriverExecution(f.db.pool,f.members[1].driverId,f.planId,f.timezone);
  await expect(readSegmentEstimate(f.db.pool,f.actor,{...selection(),fromStopId:foreign.stops[0].id})).rejects.toThrow("SEGMENT_STOP_INVALID");
  await expect(readSegmentEstimate(f.db.pool,f.actor,{...selection(),executionId:randomUUID()})).rejects.toThrow("SEGMENT_ROUTE_CHANGED");
  await expect(readSegmentEstimate(f.db.pool,randomUUID(),selection())).rejects.toMatchObject({status:401});
  const user=await createUser(f.db.pool,f.actor,{login:randomUUID(),name:"Revoked QA",password:randomUUID()});
  await setUserActive(f.db.pool,f.actor,user.id,false);
  await expect(readSegmentEstimate(f.db.pool,user.id,selection())).rejects.toMatchObject({status:401});
  const settlement=await createUser(f.db.pool,f.actor,{login:randomUUID(),name:"Settlement QA",password:randomUUID(),role:"settlement"});
  await expect(readSegmentEstimate(f.db.pool,settlement.id,selection())).rejects.toMatchObject({status:403});
});
it("rejects stale GPS over a cached result and recovers on a fresh sample; missing config is not a zero",async()=>{
  await sample(); await readSegmentEstimate(f.db.pool,f.actor,selection());
  // Tracking correctly refuses a regressive observation; age the stored fixture instead.
  await f.db.pool.query("UPDATE route_live_tracking SET observed_at=now()-interval '31 seconds' WHERE execution_id=$1",[execution.id]);
  await expect(readSegmentEstimate(f.db.pool,f.actor,selection())).rejects.toThrow("SEGMENT_GPS_STALE");
  await sample(); expect((await readSegmentEstimate(f.db.pool,f.actor,selection())).travelSeconds).toBe(0);
  await f.db.pool.query("UPDATE route_customers SET unloading_minutes=NULL");
  const result=await readSegmentEstimate(f.db.pool,f.actor,selection()); expect(result.unknownServiceStops).toBe(3); expect(result.serviceSeconds).toBe(0);
  const live=(await readLiveRoutes(f.db.pool,f.actor)).routes.find(r=>r.id===execution.id)!;
  expect(live.stops.every(s=>s.unloadingMinutes===null)).toBe(true);
});
it.runIf(process.env.RUN_SEGMENT_GOOGLE_REAL === "1")("real Google traffic contract, read-through/retry and in-flight context fence",async()=>{
  expect(process.env.RUTAS_GOOGLE_ROUTES_API_KEY).toBeTruthy();
  // Actual public road coordinates in Guadalajara; requests go to Google, never an HTTP stub.
  const points=[{latitude:20.6767,longitude:-103.3475},{latitude:20.6736,longitude:-103.344},{latitude:20.6671,longitude:-103.3496}];
  const start=performance.now(); const road=await requestSegmentRoadTime(points,AbortSignal.timeout(25000));
  expect(road).toBeGreaterThan(0); expect(Number.isSafeInteger(road)).toBe(true);
  await expect(requestSegmentRoadTime(points,AbortSignal.abort())).rejects.toThrow("SEGMENT_GOOGLE_UNAVAILABLE");
  const input={...selection(),fromCurrent:false};
  await f.db.pool.query("UPDATE route_driver_execution_stops SET latitude=$2,longitude=$3 WHERE id=$1",[execution.stops[4].id,points[0].latitude,points[0].longitude]);
  // Configuration failures must be evicted, so the same selection can recover.
  const key=process.env.RUTAS_GOOGLE_ROUTES_API_KEY;
  try { delete process.env.RUTAS_GOOGLE_ROUTES_API_KEY;
    await expect(readSegmentEstimate(f.db.pool,f.actor,input)).rejects.toThrow("SEGMENT_GOOGLE_CONFIG");
  } finally { process.env.RUTAS_GOOGLE_ROUTES_API_KEY=key; }
  const recovered=await readSegmentEstimate(f.db.pool,f.actor,input); expect(recovered.travelSeconds).toBeGreaterThan(0);
  await f.db.pool.query("UPDATE route_customers SET unloading_minutes=12");
  const calculating=readSegmentEstimate(f.db.pool,f.actor,input);
  // Change relevant real PostgreSQL context while the real network request is outstanding.
  const observed=calculating.then(()=>"returned",e=>(e as Error).message);
  await new Promise(resolve=>setTimeout(resolve,100));
  await f.db.pool.query("UPDATE route_customers SET unloading_minutes=13");
  expect(await observed).toBe("SEGMENT_ROUTE_CHANGED");
  expect((await readSegmentEstimate(f.db.pool,f.actor,input)).serviceSeconds).toBe(26*60);
  console.log(JSON.stringify({check:"segment-google-real",roadSeconds:road,milliseconds:Math.round(performance.now()-start),contextFence:true}));
},120000);
