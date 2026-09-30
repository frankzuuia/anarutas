import { describe, expect, it } from "vitest";
import { trackingEta } from "../src/core/live-eta-validation";
import { routeEta, type LiveEta } from "../src/core/live-eta";
import type { LiveRoute } from "../src/core/live-routes";

const now = new Date("2026-09-27T12:00:00Z");
const target = "00000000-0000-4000-8000-000000000001";
const payload = { targetStopId: target, state: "ready", remainingSeconds: 1200, ageMilliseconds: 0 };
const eta: LiveEta = { targetStopId: target, state: "ready", remainingSeconds: 1200, observedAt: now.toISOString() };
const route: Pick<LiveRoute, "eta" | "targetStopId" | "arrivedStopId" | "location"> = { targetStopId: target,
  arrivedStopId: null, eta, location: { latitude: 20, longitude: -103, accuracy: 5,
    observedAt: now.toISOString(), receivedAt: now.toISOString(), stopped: false } };
describe("ETA wire contract", () => {
  it("supports old APKs, real seconds and independent observation age", () => {
    expect(trackingEta(undefined, target, now)).toBeNull();
    expect(trackingEta(null, target, now)).toBeNull();
    expect(trackingEta(payload, target, now)).toEqual(eta);
    expect(trackingEta({ ...payload, ageMilliseconds: 120000 }, target, now)?.observedAt).toBe("2026-09-27T11:58:00.000Z");
    for (const seconds of [0, 2147483647]) expect(trackingEta({ ...payload, remainingSeconds: seconds }, target, now)?.remainingSeconds).toBe(seconds);
    for (const state of ["calculating", "unavailable"]) expect(trackingEta({ ...payload, state, remainingSeconds: null }, target, now)?.state).toBe(state);
  });
  it("rejects malformed/foreign data without numeric coercion", () => {
    for (const raw of [[], "", 0, false, () => null,
      { ...payload, targetStopId: "00000000-0000-4000-8000-000000000002" },
      { ...payload, state: "bad" }, { ...payload, state: "bad", remainingSeconds: null }, ...[null, undefined, -1, 1.5, "60", NaN, Infinity, 2147483648].map(remainingSeconds => ({ ...payload, remainingSeconds })),
      ...[undefined, "0", -1, NaN, Infinity, 120001].map(ageMilliseconds => ({ ...payload, ageMilliseconds })),
      { ...payload, state: "calculating", remainingSeconds: 0 }, { ...payload, state: "unavailable", remainingSeconds: undefined }]) {
      expect(() => trackingEta(raw, target, now)).toThrow("INVALID_TRACKING_ETA");
    }
    expect(() => trackingEta(payload, null, now)).toThrow("INVALID_TRACKING_ETA");
    expect(() => trackingEta({ ...payload, targetStopId: "bad" }, target, now)).toThrow();
  });
});
describe("ETA presentation", () => {
  it("completion takes precedence over retained ETA or arrival", () => {
    expect(routeEta({ ...route, completedAt: now.toISOString(), arrivedStopId: target }, +now)).toBe("Ruta terminada");
  });
  it("prioritizes canonical arrival but not arrival at another stop", () => {
    expect(routeEta({ ...route, arrivedStopId: target }, +now)).toBe("En atención");
    expect(routeEta({ ...route, arrivedStopId: target, targetStopId: null }, +now)).toBe("En atención");
    expect(routeEta({ ...route, arrivedStopId: "other" }, +now)).toBe("≈20 min");
    expect(routeEta({ ...route, targetStopId: null }, +now)).toBe("Sin destino activo");
    expect(routeEta({ ...route, eta: null }, +now)).toBe("Tiempo no disponible");
    expect(routeEta({ ...route, eta: undefined }, +now)).toBe("Tiempo no disponible");
    expect(routeEta({ ...route, eta: { ...eta, targetStopId: "other" } }, +now)).toBe("Tiempo no disponible");
  });
  it("never extrapolates seconds and handles each SDK state", () => {
    for (const [seconds, label] of [[0, "<1 min"], [59, "<1 min"], [60, "≈1 min"], [61, "≈2 min"], [1200, "≈20 min"]] as const) {
      expect(routeEta({ ...route, eta: { ...eta, remainingSeconds: seconds } }, +now + 15000)).toBe(label);
    }
    expect(routeEta({ ...route, eta: { ...eta, state: "calculating", remainingSeconds: null } }, +now)).toBe("Calculando…");
    expect(routeEta({ ...route, eta: { ...eta, state: "unavailable", remainingSeconds: null } }, +now)).toBe("Tiempo no disponible");
    expect(routeEta({ ...route, eta: { ...eta, state: "unavailable", remainingSeconds: 1200 } }, +now)).toBe("Tiempo no disponible");
    expect(routeEta({ ...route, eta: { ...eta, remainingSeconds: null } }, +now)).toBe("Tiempo no disponible");
  });
  it("requires fresh ETA and GPS independently, rejects future/invalid times and stopped sessions", () => {
    expect(routeEta(route, +now + 30000)).toBe("≈20 min");
    expect(routeEta(route, +now + 30001)).toBe("Tiempo desactualizado");
    for (const offset of [-1, 30001]) {
      const timestamp = new Date(+now - offset).toISOString();
      expect(routeEta({ ...route, eta: { ...eta, observedAt: timestamp } }, +now)).toBe("Tiempo desactualizado");
      expect(routeEta({ ...route, location: { ...route.location!, observedAt: timestamp } }, +now)).toBe("Tiempo desactualizado");
    }
    expect(routeEta({ ...route, eta: { ...eta, observedAt: "bad" } }, +now)).toBe("Tiempo desactualizado");
    expect(routeEta({ ...route, location: { ...route.location!, observedAt: "bad" } }, +now)).toBe("Tiempo desactualizado");
    expect(routeEta({ ...route, location: { ...route.location!, stopped: true } }, +now)).toBe("Tiempo desactualizado");
    expect(routeEta({ ...route, location: null }, +now)).toBe("Tiempo desactualizado");
  });
});
