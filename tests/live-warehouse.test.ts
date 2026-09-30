import { expect, it } from "vitest";
import { liveWarehouseDestination, trackingWarehouseDestination } from "../src/core/live-warehouse-policy";
import { routeDestinationLabel, warehouseReturnStatus } from "../src/core/live-route-destination";
import { trackingEta } from "../src/core/live-eta-validation";
import { routeEta } from "../src/core/live-eta";
import type { LiveRoute } from "../src/core/live-routes";
import type { RoutingSettings } from "../src/core/routing-contract";

const now = new Date("2026-09-29T18:00:00Z");
const destination = { kind: "warehouse" as const, depotVersion: 3 };
const settings: RoutingSettings = { depotAddress: "Bodega real", depotLocation: { latitude: 20.64, longitude: -103.4, placeId: null }, version: 3, updatedAt: null };
const stored = { version: 3, target: null, stopped: false, completed: false, receivedAt: now };
const warehouse = { ...destination, address: settings.depotAddress, ...settings.depotLocation!, observedAt: now.toISOString() };
const orders = [{ shipment_id: "one", status: "delivered" }, { shipment_id: "two", status: "rescheduled" }];
const route: Pick<LiveRoute, "completedAt" | "warehouseDestination" | "eta" | "targetStopId" | "arrivedStopId" | "location" | "stops"> = {
  targetStopId: null, arrivedStopId: null, warehouseDestination: warehouse, stops: [],
  location: { latitude: 20.64, longitude: -103.4, accuracy: 5, observedAt: now.toISOString(), receivedAt: now.toISOString(), stopped: false },
  eta: { targetStopId: null, depotVersion: 3, state: "ready", remainingSeconds: 61, observedAt: now.toISOString() },
};
it("normalizes only the exclusive versioned warehouse wire destination, preserving old APKs", () => {
  expect(trackingWarehouseDestination(undefined, "customer")).toBeNull();
  expect(trackingWarehouseDestination(null, null)).toBeNull();
  expect(trackingWarehouseDestination({ ...destination, latitude: 0, address: "untrusted" }, null)).toEqual(destination);
  for (const depotVersion of [1, 2147483647]) expect(trackingWarehouseDestination({ ...destination, depotVersion }, null)?.depotVersion).toBe(depotVersion);
  for (const raw of [[], Object.assign([], destination), Object.assign(() => null, destination), "", 0, false, {}, { ...destination, kind: "customer" },
    ...[null, undefined, 0, -1, 1.5, "3", NaN, Infinity, 2147483648].map(depotVersion => ({ ...destination, depotVersion }))])
    expect(() => trackingWarehouseDestination(raw, null)).toThrow("INVALID_TRACKING_DESTINATION");
  expect(() => trackingWarehouseDestination(destination, "customer")).toThrow("INVALID_TRACKING_DESTINATION");
});
it("projects the current server origin only for the exact terminal publication", () => {
  const value = liveWarehouseDestination(stored, settings, ["one", "two"], orders);
  expect(value).toEqual({ ...destination, address: "Bodega real", latitude: 20.64, longitude: -103.4, observedAt: now.toISOString() });
  for (const change of [{ version: null }, { target: "customer" }, { stopped: true }, { completed: true }, { receivedAt: null }])
    expect(liveWarehouseDestination({ ...stored, ...change }, settings, ["one", "two"], orders)).toBeNull();
  expect(liveWarehouseDestination(stored, { ...settings, depotLocation: null }, ["one", "two"], orders)).toBeNull();
  expect(liveWarehouseDestination(stored, { ...settings, version: 4 }, ["one", "two"], orders)).toBeNull();
  expect(liveWarehouseDestination({ ...stored, version: null }, { ...settings, version: null as unknown as number }, ["one", "two"], orders)).toBeNull();
  for (const status of ["open", "closed_pending", "rejected", "unknown"]) {
    expect(liveWarehouseDestination(stored, settings, ["one", "two"], [{ ...orders[0], status }, orders[1]])).toBeNull();
  }
  for (const actual of [[], orders.slice(0, 1), [...orders, orders[0]], [orders[0], orders[0]], [{ ...orders[0], shipment_id: "foreign" }, orders[1]]])
    expect(liveWarehouseDestination(stored, settings, ["one", "two"], actual)).toBeNull();
  expect(liveWarehouseDestination(stored, settings, [], [])).toBeNull();
  expect(() => liveWarehouseDestination(stored, settings, ["one"], null as unknown as typeof orders)).toThrow(TypeError);
});
it("fences auxiliary SDK ETA to the same warehouse version without an invented stop UUID", () => {
  const raw = { targetStopId: null, depotVersion: 3, state: "ready", remainingSeconds: 61, ageMilliseconds: 0 };
  expect(trackingEta(raw, null, now, destination)).toEqual(route.eta);
  expect(trackingEta(null, null, now, destination)).toBeNull();
  for (const change of [{ targetStopId: "warehouse" }, { depotVersion: 2 }, { depotVersion: undefined }, { depotVersion: "3" }])
    expect(() => trackingEta({ ...raw, ...change }, null, now, destination)).toThrow("INVALID_TRACKING_ETA");
  expect(() => trackingEta(raw, "customer", now, destination)).toThrow("INVALID_TRACKING_ETA");
  expect(() => trackingEta(raw, null, now)).toThrow();
  for (const state of ["calculating", "unavailable"])
    expect(trackingEta({ ...raw, state, remainingSeconds: null }, null, now, destination)?.state).toBe(state);
});
it("uses an independent recent heartbeat for the return label, not old GPS or delivered counters", () => {
  expect(warehouseReturnStatus(route, +now)).toBe("active");
  expect(warehouseReturnStatus(route, +now + 30000)).toBe("active");
  expect(warehouseReturnStatus(route, +now + 30001)).toBe("stale");
  for (const observedAt of ["bad", new Date(+now + 1).toISOString()])
    expect(warehouseReturnStatus({ ...route, warehouseDestination: { ...warehouse, observedAt } }, +now)).toBe("stale");
  for (const change of [{ warehouseDestination: undefined }, { warehouseDestination: null }, { completedAt: now.toISOString() },
    { targetStopId: "customer" }, { arrivedStopId: "customer" }, { location: { ...route.location!, stopped: true } }])
    expect(warehouseReturnStatus({ ...route, ...change }, +now)).toBeNull();
  expect(warehouseReturnStatus({ ...route, location: null }, +now)).toBe("active");
  expect(routeDestinationLabel(route, +now)).toBe("De regreso a bodega");
  expect(routeDestinationLabel(route, +now + 30001)).toBe("Regreso a bodega · sin confirmación reciente");
  expect(routeDestinationLabel({ ...route, completedAt: now.toISOString() }, +now)).toBe("Ruta terminada");
  expect(routeDestinationLabel({ ...route, warehouseDestination: null }, +now)).toBe("Sin destino confirmado");
  const stops = [{ id: "customer", position: 2, customer: "Cliente" }] as LiveRoute["stops"];
  expect(routeDestinationLabel({ ...route, stops, targetStopId: "customer" }, +now)).toBe("Destino: 2 · Cliente");
  expect(routeDestinationLabel({ ...route, stops, arrivedStopId: "customer" }, +now)).toBe("Atendiendo: 2 · Cliente");
  expect(routeDestinationLabel({ ...route, stops, targetStopId: "foreign" }, +now)).toBe("Sin destino confirmado");
});
it("warehouse time remains independent and requires actual fresh GPS and matching SDK ETA", () => {
  expect(routeEta(route, +now)).toBe("≈2 min");
  expect(routeEta(route, +now + 30001)).toBe("Tiempo desactualizado");
  expect(routeEta({ ...route, warehouseDestination: { ...warehouse, observedAt: new Date(+now - 30001).toISOString() } }, +now)).toBe("Tiempo desactualizado");
  expect(routeEta({ ...route, warehouseDestination: null, targetStopId: "customer", eta: { ...route.eta!, targetStopId: "customer" } }, +now)).toBe("Tiempo no disponible");
  for (const eta of [null, { ...route.eta!, depotVersion: 4 }, { ...route.eta!, depotVersion: undefined }, { ...route.eta!, targetStopId: "customer" }])
    expect(routeEta({ ...route, eta }, +now)).toBe("Tiempo no disponible");
  expect(routeEta({ ...route, location: null }, +now)).toBe("Tiempo desactualizado");
  expect(routeEta({ ...route, location: { ...route.location!, observedAt: new Date(+now - 30001).toISOString() } }, +now)).toBe("Tiempo desactualizado");
  expect(routeEta({ ...route, completedAt: now.toISOString() }, +now)).toBe("Ruta terminada");
});
