import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  arrivalLateness, correctedDeliveryAddress, distanceMeters, geoPoint, gpsSample, groupExecutionStops,
  lastClosingMinute, objectInput, operationPolicyInput, validateProximity,
} from "../src/core/driver-execution-policy";
import { incidentFilters } from "../src/core/driver-incidents";

const now = new Date("2026-09-24T18:00:00.000Z");
const policy = { radiusMeters: 100, maxAccuracyMeters: 50, maxSampleAgeSeconds: 30, version: 1 };
const point = { latitude: 20.64, longitude: -103.4 };
const sample = { ...point, accuracyMeters: 5, ageMilliseconds: 0, capturedAt: now.toISOString(), mock: false as const };

describe("arrival policy / no providers", () => {
  it("accepts only an explicitly confirmed delivery address and keeps legacy omission", () => {
    expect(correctedDeliveryAddress(undefined)).toBeNull();
    const fields = { street: "  Calle nueva 4  ", neighborhood: " Centro ", postalCode: " 44100 ", city: " Guadalajara " };
    expect(correctedDeliveryAddress(fields)).toEqual({ street: "Calle nueva 4", neighborhood: "Centro",
      postalCode: "44100", city: "Guadalajara", formatted: "Calle nueva 4, Col. Centro, C.P. 44100, Guadalajara" });
    expect(correctedDeliveryAddress({ ...fields, street: "x".repeat(300) })?.street).toHaveLength(300);
    for (const value of [null, "", 1, [], { ...fields, street: " " }, { ...fields, city: "" },
      { ...fields, postalCode: "x".repeat(21) }, { ...fields, street: "x".repeat(301) },
      { ...fields, street: "Calle\n1" }, { ...fields, neighborhood: null }])
      expect(() => correctedDeliveryAddress(value)).toThrow("INVALID_INPUT");
  });
  it.each([null, [], 0, "", true, undefined])("rejects non-object %s", (value) => expect(() => objectInput(value)).toThrow("INVALID_INPUT"));
  it.each([NaN, Infinity, -Infinity, "20", null, undefined, 91, -91])("rejects latitude %s", (latitude) =>
    expect(() => geoPoint({ latitude, longitude: 0 })).toThrow("INVALID_INPUT"));
  it.each([181, -181, NaN, "-103", null])("rejects longitude %s", (longitude) =>
    expect(() => geoPoint({ latitude: 0, longitude })).toThrow("INVALID_INPUT"));
  it("accepts zero, poles and antimeridian and measures known distances", () => {
    expect(geoPoint({ latitude: -90, longitude: -180 })).toEqual({ latitude: -90, longitude: -180 });
    expect(geoPoint({ latitude: 90, longitude: 180 })).toEqual({ latitude: 90, longitude: 180 });
    expect(distanceMeters(point, point)).toBe(0);
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111195.080, 2);
    expect(distanceMeters({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 })).toBeCloseTo(222.39, 1);
    expect(distanceMeters({ latitude: 90, longitude: 0 }, { latitude: -90, longitude: 0 })).toBeCloseTo(20015114.44, 1);
    expect(distanceMeters({ latitude: 45, longitude: 0 }, { latitude: 45, longitude: 1 })).toBeCloseTo(78626.296, 2);
  });
  it("validates configurable settings without truncating fractional inputs", () => {
    expect(operationPolicyInput({ ...policy, expectedVersion: 1 })).toEqual(policy);
    for (const input of [
      { radiusMeters: 24 }, { radiusMeters: 1001 }, { radiusMeters: 50.5 },
      { maxAccuracyMeters: 0 }, { maxAccuracyMeters: 101 }, { maxAccuracyMeters: 1.5 },
      { maxSampleAgeSeconds: 4 }, { maxSampleAgeSeconds: 121 }, { maxSampleAgeSeconds: 5.5 }, { expectedVersion: 0 },
    ]) expect(() => operationPolicyInput({ ...policy, expectedVersion: 1, ...input })).toThrow();
    expect(operationPolicyInput({ radiusMeters: 25, maxAccuracyMeters: 1, maxSampleAgeSeconds: 5, expectedVersion: 2 }).radiusMeters).toBe(25);
    expect(operationPolicyInput({ radiusMeters: 1000, maxAccuracyMeters: 1000, maxSampleAgeSeconds: 120, expectedVersion: 1 }).maxSampleAgeSeconds).toBe(120);
  });
  it("requires explicit trustworthy GPS metadata", () => {
    expect(gpsSample(sample)).toEqual(sample);
    for (const mock of [true, undefined, null, "false"]) expect(() => gpsSample({ ...sample, mock })).toThrow("LOCATION_UNTRUSTED");
    for (const capturedAt of ["bad", "", null, undefined, 4]) expect(() => gpsSample({ ...sample, capturedAt })).toThrow("INVALID_INPUT");
    for (const accuracyMeters of [-1, 100001, NaN]) expect(() => gpsSample({ ...sample, accuracyMeters })).toThrow("INVALID_INPUT");
    for (const ageMilliseconds of [-1, 0.5, Infinity]) expect(() => gpsSample({ ...sample, ageMilliseconds })).toThrow("INVALID_INPUT");
  });
  it("checks both monotonic age and wall time including exact edges", () => {
    expect(validateProximity(sample, point, policy, now)).toBe(0);
    const oldest = { ...sample, capturedAt: new Date(now.getTime() - 30000).toISOString(), ageMilliseconds: 30000 };
    expect(validateProximity(oldest, point, policy, now)).toBe(0);
    expect(() => validateProximity({ ...oldest, ageMilliseconds: 30001 }, point, policy, now)).toThrow("LOCATION_STALE");
    expect(() => validateProximity({ ...sample, capturedAt: new Date(now.getTime() - 30001).toISOString() }, point, policy, now)).toThrow("LOCATION_STALE");
    expect(() => validateProximity({ ...sample, capturedAt: new Date(now.getTime() + 1).toISOString() }, point, policy, now)).toThrow("LOCATION_STALE");
  });
  it("does not expand the geofence with inaccurate GPS", () => {
    expect(validateProximity({ ...sample, accuracyMeters: 50 }, point, policy, now)).toBe(0);
    expect(() => validateProximity({ ...sample, accuracyMeters: 50.01 }, point, policy, now)).toThrow("LOCATION_IMPRECISE");
    const target = { ...point, latitude: point.latitude + 0.0005 };
    expect(validateProximity(sample, target, policy, now)).toBeGreaterThan(55);
    expect(() => validateProximity({ ...sample, accuracyMeters: 50 }, target, policy, now)).toThrow("OUTSIDE_ARRIVAL_RADIUS");
    expect(validateProximity({ ...sample, accuracyMeters: 100 }, point, { ...policy, maxAccuracyMeters: 100 }, now)).toBe(0);
  });
  it("groups only adjacent visits with identical customer/address/point", () => {
    const ids = Array.from({ length: 7 }, () => randomUUID());
    const customers = new Map(ids.map((id, index) => [id, index === 2 ? "B" : "A"]));
    const orders = ids.map((id) => ({ id, ...point, customerName: "Mismo nombre", orderName: "S", address: "A", deliveryWindows: [] }));
    orders[4].address = "B";
    orders[5].latitude += 1;
    orders[6].longitude += 1;
    expect(groupExecutionStops(orders, customers).map((stop) => stop.orders.length)).toEqual([2, 1, 1, 1, 1, 1]);
    expect(groupExecutionStops([], customers)).toEqual([]);
    expect(() => groupExecutionStops(orders, new Map())).toThrow("EXECUTION_CUSTOMER_MISSING");
    expect(() => groupExecutionStops([{ ...orders[0], id: "bad" }], new Map([["bad", randomUUID()]]))).toThrow("INVALID_INPUT");
    expect(groupExecutionStops([orders[0], { ...orders[1], latitude: 21 }], customers)).toHaveLength(2);
    expect(groupExecutionStops([orders[0], { ...orders[1], longitude: -102 }], customers)).toHaveLength(2);
  });
  it("distinguishes no window, future windows, exact closure and actual delay", () => {
    expect(lastClosingMinute([])).toBeNull();
    expect(lastClosingMinute([{ startMinute: 600, endMinute: 720 }, { startMinute: 800, endMinute: 900 }])).toBe(900);
    expect(lastClosingMinute([{ startMinute: 0, endMinute: 1440 }])).toBe(1440);
    expect(() => lastClosingMinute([{ startMinute: 0, endMinute: 1441 }])).toThrow();
    expect(arrivalLateness(now, null)).toBeNull();
    expect(arrivalLateness(now, now)).toBe(0);
    expect(arrivalLateness(now, new Date(now.getTime() + 1))).toBe(0);
    expect(arrivalLateness(now, new Date(now.getTime() - 1))).toBe(1);
    expect(arrivalLateness(now, new Date(now.getTime() - 60001))).toBe(61);
  });
  it("validates date/driver filters and binds cursors to them", () => {
    const query = new URLSearchParams({ from: "2026-09-24", to: "2026-09-25", driverId: randomUUID() });
    const filter = incidentFilters(query, "UTC");
    const id = randomUUID();
    const cursor = Buffer.from(JSON.stringify({ filterHash: filter.filterHash, time: now.toISOString(), id })).toString("base64url");
    query.set("cursor", cursor);
    expect(incidentFilters(query, "UTC").cursor).toEqual({ time: now.toISOString(), id });
    query.set("driverId", randomUUID());
    expect(() => incidentFilters(query, "UTC")).toThrow("INVALID_CURSOR");
    for (const value of ["broken", "a".repeat(513), Buffer.from(JSON.stringify({ filterHash: filter.filterHash, time: "bad", id })).toString("base64url")]) {
      query.set("cursor", value);
      expect(() => incidentFilters(query, "UTC")).toThrow("INVALID_CURSOR");
    }
    expect(() => incidentFilters(new URLSearchParams({ from: "2026-09-25", to: "2026-09-24" }), "UTC")).toThrow("INVALID_DATE");
    expect(incidentFilters(new URLSearchParams(), "UTC").driverId).toBeNull();
  });
});
