import { describe, expect, it } from "vitest";
import { liveMapFrameKey, locationHealth, routesForDriver } from "../src/core/live-route-presentation";
import type { LiveRoute } from "../src/core/live-routes";

const now = Date.parse("2026-09-26T18:00:00Z");
const location: NonNullable<LiveRoute["location"]> = { latitude: 20.65, longitude: -103.4,
  accuracy: 7, observedAt: new Date(now).toISOString(), receivedAt: new Date(now).toISOString(), stopped: false };

describe("live map presentation policy", () => {
  it("filters only by driver, without mutating or hiding routes by vehicle", () => {
    const routes = [{ driverId: "one", vehicleId: "a" }, { driverId: "two", vehicleId: "b" }, { driverId: "one", vehicleId: "c" }];
    expect(routesForDriver(routes, "")).toEqual(routes);
    expect(routesForDriver(routes, "one")).toEqual([routes[0], routes[2]]);
    expect(routesForDriver(routes, "two")).toEqual([routes[1]]);
    expect(routesForDriver(routes, "missing")).toEqual([]);
    expect(routesForDriver([], "")).toEqual([]);
    expect(routes).toHaveLength(3);
  });
  it("reframes on first GPS, filter, route or explicit resize/fit, never on normal samples or ordering", () => {
    const a = { id: "a", location: null }, b = { id: "b", location };
    const initial = liveMapFrameKey([a,b], "", 0);
    expect(liveMapFrameKey([b,a], "", 0)).toBe(initial);
    expect(liveMapFrameKey([{ ...a, location },b], "", 0)).not.toBe(initial);
    expect(liveMapFrameKey([a,b], "one", 0)).not.toBe(initial);
    expect(liveMapFrameKey([a,b], "", 1)).not.toBe(initial);
    expect(liveMapFrameKey([a], "", 0)).not.toBe(initial);
    expect(liveMapFrameKey([a,{ ...b, id: "c" }], "", 0)).not.toBe(initial);
    expect(liveMapFrameKey([a,{ ...b, location: { ...location, latitude: 21, observedAt: new Date(now+5000).toISOString() } }], "", 0)).toBe(initial);
    expect(liveMapFrameKey([], "", 0)).toBe('["",0,[]]');
  });
  it("never claims a fix when the phone has sent none", () => {
    expect(locationHealth({ location: null }, now)).toEqual({ live: false, label: "Sin ubicación recibida", age: null });
  });
  it.each([
    [-1000, false, 0, true, "GPS · hace 0 s"],
    [29999, false, 29, true, "GPS · hace 29 s"],
    [30000, false, 30, true, "GPS · hace 30 s"],
    [31000, false, 31, false, "Última ubicación · hace 31 s"],
    [59000, false, 59, false, "Última ubicación · hace 59 s"],
    [60000, false, 60, false, "Última ubicación · hace 1 min"],
    [179000, false, 179, false, "Última ubicación · hace 2 min"],
    [0, true, 0, false, "Seguimiento detenido"],
    [90000, true, 90, false, "Seguimiento detenido"],
  ])("keeps timestamp and tracking state honest: %s ms, stopped %s", (elapsed, stopped, age, live, label) => {
    expect(locationHealth({ location: { ...location, stopped } }, now + elapsed)).toEqual({ age, live, label });
  });
});
