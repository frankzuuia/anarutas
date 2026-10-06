import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { LiveRoute } from "../src/core/live-routes";
import { stopProgress } from "../src/core/live-tracking-policy";
import { activeSegmentStop, buildSegmentPlan, segmentContextKey, segmentGpsFresh, segmentMinutes, toggleSegmentStop } from "../src/core/live-segment-policy";
import { parseSegmentDuration, segmentRoadRequests, requestSegmentRoadTime } from "../src/core/live-segment-google";
import { segmentSelection } from "../src/core/live-segment";

const now = Date.parse("2026-10-05T16:00:00Z");
function fixture() {
  const route: LiveRoute = { id: randomUUID(), planId: randomUUID(), label: "QA", date: "2026-10-05",
    driverId: randomUUID(), driver: "QA", vehicleId: randomUUID(), vehicle: "QA", plate: "QA", startedAt: new Date(now-3600000).toISOString(),
    targetStopId: null, arrivedStopId: null, location: { latitude: 20.60, longitude: -103.4, accuracy: 5, observedAt: new Date(now).toISOString(), receivedAt: new Date(now).toISOString(), stopped: false },
    corrected: false, polylines: [], progress: { orders: 5, delivered: 0, rescheduled: 0, incidentOrders: 0, remainingStops: 5, completedStops: 0, totalStops: 5 },
    stops: Array.from({ length: 5 }, (_,i) => ({ id: randomUUID(), position: i+1, customer: `QA ${i+1}`, address: "QA",
      latitude: 20.61+i/100, longitude: -103.4, arrivedAt: null, unloadingMinutes: (i+1)*5,
      orders: [{ id: randomUUID(), name: `QA${i+1}`, status: "open" as const }], progress: stopProgress(["open"]) })) };
  route.targetStopId = route.stops[1].id;
  const selection = { executionId: route.id, fromStopId: route.stops[1].id, toStopId: route.stops[4].id, fromCurrent: true };
  return { route, selection };
}
describe("ordered stop estimate", () => {
  it("includes current GPS, 2/3/4/5 and service 2/3/4, excluding destination unloading", () => {
    const { route, selection } = fixture();
    const before = JSON.stringify(route);
    const plan = buildSegmentPlan(route, selection, now);
    expect(plan.positions).toEqual([2,3,4,5]); expect(plan.points).toHaveLength(5);
    expect(plan.points[0]).toEqual({ latitude: 20.60, longitude: -103.4 });
    expect(plan.serviceSeconds).toBe(45*60); expect(plan.unknownServiceStops).toBe(0);
    expect(plan.omittedRetries).toBe(0); expect(plan.fromCurrent).toBe(true);
    expect([plan.fromPosition,plan.toPosition]).toEqual([2,5]); expect(JSON.stringify(route)).toBe(before);
  });
  it("subtracts elapsed unloading only at the current origin; never produces negative unloading", () => {
    const { route, selection } = fixture(); route.arrivedStopId = route.targetStopId;
    for (const [elapsed,minutes] of [[120000,43],[600000,35],[3600000,35]]) {
      route.stops[1].arrivedAt = new Date(now-elapsed).toISOString();
      const plan = buildSegmentPlan(route,selection,now);
      expect(plan.serviceSeconds).toBe(minutes*60); expect(plan.points).toHaveLength(4);
    }
    for (const time of [null,"bad",new Date(now+1).toISOString()]) {
      route.stops[1].arrivedAt = time;
      expect(() => buildSegmentPlan(route,selection,now)).toThrow("SEGMENT_ROUTE_CHANGED");
    }
  });
  it("static 3→5 starts at departure from 3 and includes only service at 4; GPS is unnecessary", () => {
    const { route, selection } = fixture(); route.location = null;
    const plan = buildSegmentPlan(route,{ ...selection, fromStopId: route.stops[2].id, fromCurrent: false },now);
    expect(plan.positions).toEqual([3,4,5]); expect(plan.points).toHaveLength(3); expect(plan.serviceSeconds).toBe(1200);
  });
  it("skips attended stops and nonselected retries, keeps an open order in a mixed stop", () => {
    const { route, selection } = fixture();
    for (const status of ["delivered","rescheduled","closed_pending","rejected"] as const) {
      route.stops[2].orders[0].status = status; route.stops[2].progress = stopProgress([status]);
      const plan = buildSegmentPlan(route,selection,now);
      expect(plan.positions).toEqual([2,4,5]); expect(plan.serviceSeconds).toBe(1800);
      expect(plan.omittedRetries).toBe(["closed_pending","rejected"].includes(status) ? 1 : 0);
    }
    route.stops[2].orders.push({ id: randomUUID(), name:"mixed", status:"open" });
    expect(buildSegmentPlan(route,selection,now).positions).toEqual([2,3,4,5]);
  });
  it("follows active stop changes through the destination, then invalidates a passed destination", () => {
    const { route, selection } = fixture();
    route.targetStopId = route.stops[2].id;
    expect(buildSegmentPlan(route,selection,now).positions).toEqual([3,4,5]);
    route.targetStopId = route.stops[4].id;
    const last = buildSegmentPlan(route,selection,now);
    expect(last.positions).toEqual([5]); expect(last.points).toHaveLength(2); expect(last.serviceSeconds).toBe(0);
    route.arrivedStopId = route.targetStopId;
    expect(buildSegmentPlan(route,selection,now).points).toHaveLength(1);
    expect(() => buildSegmentPlan(route,{ ...selection,toStopId:route.stops[3].id },now)).toThrow("SEGMENT_STOP_INVALID");
  });
  it("rejects stale/future/stopped/missing GPS in live mode with inclusive 30s boundary", () => {
    const { route, selection } = fixture();
    expect(segmentGpsFresh(route,now+30000)).toBe(true);
    for (const clock of [now-1,now+30001,NaN]) expect(segmentGpsFresh(route,clock)).toBe(false);
    for (const location of [null,{ ...route.location!, stopped:true },{ ...route.location!,observedAt:"bad" }]) {
      route.location = location; expect(() => buildSegmentPlan(route,selection,now)).toThrow("SEGMENT_GPS_STALE");
    }
  });
  it("requires correct execution, endpoints and destination state", () => {
    const { route, selection } = fixture();
    expect(() => buildSegmentPlan(route,{ ...selection, executionId:randomUUID() },now)).toThrow("SEGMENT_ROUTE_CHANGED");
    expect(() => buildSegmentPlan({ ...route,completedAt:new Date(now).toISOString() },selection,now)).toThrow("SEGMENT_ROUTE_CHANGED");
    expect(() => buildSegmentPlan(route,selection,NaN)).toThrow("SEGMENT_ROUTE_CHANGED");
    for (const extra of [{ fromStopId:randomUUID() },{ toStopId:randomUUID() },{ toStopId:route.stops[0].id },{ toStopId:selection.fromStopId,fromCurrent:false }])
      expect(() => buildSegmentPlan(route,{ ...selection,...extra },now)).toThrow("SEGMENT_STOP_INVALID");
    route.targetStopId=null; expect(() => buildSegmentPlan(route,selection,now)).toThrow("SEGMENT_STOP_INVALID");
    route.arrivedStopId=route.stops[1].id; expect(activeSegmentStop(route)).toBe(route.arrivedStopId);
    route.stops[4].orders[0].status="delivered";
    expect(() => buildSegmentPlan(route,selection,now)).toThrow("SEGMENT_STOP_INVALID");
  });
  it("validates points and durations without inventing missing service", () => {
    const { route, selection } = fixture();
    for (const latitude of [null,NaN,Infinity,90.1,-90.1]) {
      route.stops[2].latitude=latitude; expect(() => buildSegmentPlan(route,selection,now)).toThrow("SEGMENT_POINTS_REQUIRED");
    }
    route.stops[2].latitude=20;
    for (const longitude of [null,NaN,Infinity,180.1,-180.1]) {
      route.stops[2].longitude=longitude; expect(() => buildSegmentPlan(route,selection,now)).toThrow("SEGMENT_POINTS_REQUIRED");
    }
    route.stops[2].longitude=-103;
    for (const minutes of [-1,0.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
      route.stops[2].unloadingMinutes=minutes; expect(() => buildSegmentPlan(route,selection,now)).toThrow("SEGMENT_SERVICE_INVALID");
    }
    for (const minutes of [null,undefined,0]) {
      route.stops[2].unloadingMinutes=minutes;
      const plan=buildSegmentPlan(route,selection,now); expect(plan.serviceSeconds).toBe(1800); expect(plan.unknownServiceStops).toBe(minutes===0 ? 0 : 1);
    }
  });
  it("deduplicates adjacent coordinates only, keeps a required later return to the same point", () => {
    const { route, selection } = fixture();
    route.stops[2].latitude=route.stops[1].latitude;
    route.stops[4].latitude=route.stops[1].latitude;
    const plan=buildSegmentPlan(route,selection,now); expect(plan.points).toHaveLength(4); expect(plan.positions).toHaveLength(4);
    expect(plan.serviceSeconds).toBe(2700);
  });
  it("invalidates cache on stop, service, position and active state changes, but not GPS motion", () => {
    const { route, selection } = fixture(); const key=segmentContextKey(route,selection);
    route.location!.latitude+=0.1; expect(segmentContextKey(route,selection)).toBe(key);
    for (const mutate of [(r:LiveRoute)=>{r.stops[0].unloadingMinutes=null;},(r:LiveRoute)=>{r.stops[0].latitude=21;},
      (r:LiveRoute)=>{r.stops[0].orders[0].status="delivered";},(r:LiveRoute)=>{r.targetStopId=r.stops[2].id;},
      (r:LiveRoute)=>{r.stops[0].arrivedAt=new Date(now).toISOString();},(r:LiveRoute)=>{r.stops[0].position=6;}]) {
      const changed=structuredClone(route); mutate(changed); expect(segmentContextKey(changed,selection)).not.toBe(key);
    }
  });
  it("selects either order, clears pressed clocks, replaces a full pair and isolates executions", () => {
    const { route }=fixture(); const [one,two,three,,five]=route.stops;
    const first=toggleSegmentStop(route,null,five.id)!; expect(first.toStopId).toBe(""); expect(first.fromCurrent).toBe(false);
    const pair=toggleSegmentStop(route,first,two.id)!; expect(pair).toMatchObject({fromStopId:two.id,toStopId:five.id,fromCurrent:true});
    expect(toggleSegmentStop(route,pair,two.id)).toBeNull(); expect(toggleSegmentStop(route,pair,five.id)?.toStopId).toBe("");
    expect(toggleSegmentStop(route,pair,one.id)?.fromStopId).toBe(one.id);
    route.targetStopId=three.id; expect(toggleSegmentStop(route,pair,three.id)).toBeNull();
    expect(toggleSegmentStop(route,{...pair,toStopId:""},five.id)?.fromStopId).toBe(three.id);
    expect(toggleSegmentStop(route,{...pair,executionId:randomUUID()},one.id)?.toStopId).toBe("");
    expect(toggleSegmentStop(route,pair,"missing")).toBe(pair);
    one.orders[0].status="delivered"; expect(toggleSegmentStop(route,pair,one.id)).toBe(pair);
    expect([0,1,59,60,61].map(segmentMinutes)).toEqual(["0 min","<1 min","<1 min","≈1 min","≈2 min"]);
  });
});
describe("Google wire and request contracts", () => {
  it("uses fixed ordered intermediates with traffic and splits without dropping any leg", () => {
    for (const count of [0,1,2,27,28,53,54,100]) {
      const points=Array.from({length:count},(_,i)=>({latitude:20+i/1000,longitude:-103}));
      const requests=segmentRoadRequests(points);
      expect(requests.length).toBe(Math.ceil(Math.max(0,count-1)/26));
      const rebuilt=requests.flatMap((r,i)=>[...(i?[]:[r.origin.location.latLng]),...r.intermediates.map(p=>p.location.latLng),r.destination.location.latLng]);
      expect(rebuilt).toEqual(count>1 ? points : []);
      for(const r of requests) { expect(r.intermediates.length).toBeLessThanOrEqual(25); expect(r).toMatchObject({travelMode:"DRIVE",routingPreference:"TRAFFIC_AWARE",optimizeWaypointOrder:false,computeAlternativeRoutes:false}); }
    }
  });
  it("accepts protobuf durations and rejects missing, malformed, negative and unsafe values", () => {
    for (const [duration,seconds] of [["0s",0],["60s",60],["60.000000001s",61],["1.5s",2]] as const)
      expect(parseSegmentDuration({routes:[{duration}]})).toBe(seconds);
    for (const raw of [null,{}, {routes:{}},{routes:[]},{routes:[{},{}]}, ...[undefined,null,0,"s"," s","1e3s","0x10s","NaNs","-1s","1.1234567890s","9007199254740992s"].map(duration=>({routes:[{duration}]}))])
      expect(()=>parseSegmentDuration(raw)).toThrow("SEGMENT_GOOGLE_RESPONSE");
  });
  it("zero road distance needs no Google request; a missing key is explicit", async () => {
    const old=process.env.RUTAS_GOOGLE_ROUTES_API_KEY;
    try { delete process.env.RUTAS_GOOGLE_ROUTES_API_KEY;
      expect(await requestSegmentRoadTime([{latitude:20,longitude:-103}],AbortSignal.timeout(1000))).toBe(0);
      await expect(requestSegmentRoadTime([{latitude:20,longitude:-103},{latitude:21,longitude:-103}],AbortSignal.timeout(1000))).rejects.toThrow("SEGMENT_GOOGLE_CONFIG");
    } finally { if(old===undefined) delete process.env.RUTAS_GOOGLE_ROUTES_API_KEY; else process.env.RUTAS_GOOGLE_ROUTES_API_KEY=old; }
  });
  it("only accepts three UUIDs and an explicit boolean, never client coordinates/services", () => {
    const {selection}=fixture(); expect(segmentSelection(selection)).toEqual(selection);
    for(const raw of [{},{...selection,extra:1},{...selection,fromCurrent:"true"},{...selection,executionId:"bad"},{...selection,fromStopId:"bad"},{...selection,toStopId:"bad"}])
      expect(()=>segmentSelection(raw)).toThrow();
  });
});
