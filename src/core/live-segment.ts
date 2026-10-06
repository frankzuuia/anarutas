import type { Pool } from "pg";
import { AppError } from "./errors";
import { uuid } from "./orders-validation";
import { readLiveRoutes } from "./live-routes";
import { buildSegmentPlan, type SegmentEstimate, type SegmentSelection } from "./live-segment-policy";
import { requestSegmentRoadTime } from "./live-segment-google";

export function segmentSelection(raw: Record<string, unknown>): SegmentSelection {
  if (Object.keys(raw).some(k => !["executionId","fromStopId","toStopId","fromCurrent"].includes(k)) ||
    typeof raw.fromCurrent !== "boolean") throw new AppError("INVALID_INPUT");
  return { executionId: uuid(raw.executionId), fromStopId: uuid(raw.fromStopId),
    toStopId: uuid(raw.toStopId), fromCurrent: raw.fromCurrent };
}

type Entry = { expires: number; value: Promise<SegmentEstimate> };
const pools = new WeakMap<Pool, { values: Map<string,Entry>; active: number }>();

export async function readSegmentEstimate(pool: Pool, actor: string, raw: Record<string,unknown>): Promise<SegmentEstimate> {
  const input = segmentSelection(raw);
  const read = async () => {
    const report = await readLiveRoutes(pool, actor);
    const route = report.routes.find(r => r.id === input.executionId);
    if (!route) throw new AppError("SEGMENT_ROUTE_CHANGED", 409);
    return buildSegmentPlan(route, input, Date.parse(report.serverTime));
  };
  // Authorization and current state precede every cache lookup, even for a shared result.
  const plan = await read();
  let state = pools.get(pool);
  if (!state) { state = { values: new Map(), active: 0 }; pools.set(pool,state); }
  const now = Date.now();
  for (const [key,entry] of state.values) if (entry.expires <= now) state.values.delete(key);
  let entry = state.values.get(plan.contextKey);
  if (!entry) {
    if (state.active >= 8) throw new AppError("SEGMENT_BUSY", 429);
    if (state.values.size >= 128) state.values.delete(state.values.keys().next().value!);
    const owned = state;
    owned.active++;
    const expires = now + 60000;
    const value = (async () => {
      try {
        const travelSeconds = await requestSegmentRoadTime(plan.points, AbortSignal.timeout(25000));
        const { points: _points, ...publicPlan } = plan;
        void _points;
        return { ...publicPlan, executionId: input.executionId, travelSeconds,
          totalSeconds: travelSeconds + plan.serviceSeconds,
          calculatedAt: new Date(now).toISOString(), expiresAt: new Date(expires).toISOString() };
      } finally { owned.active--; }
    })();
    entry = { expires, value };
    owned.values.set(plan.contextKey, entry);
    void value.catch(() => { if (owned.values.get(plan.contextKey)?.value === value) owned.values.delete(plan.contextKey); });
  }
  const result = await entry.value;
  const current = await read();
  if (current.contextKey !== result.contextKey || Date.now() >= Date.parse(result.expiresAt))
    throw new AppError("SEGMENT_ROUTE_CHANGED", 409);
  return result;
}
