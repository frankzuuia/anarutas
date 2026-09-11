import { describe, expect, it } from "vitest";
import { parseRoadLeg, roadRequest, visitTiming } from "../src/core/route-road";

describe("Google road contracts / no network substitutions", () => {
  const a = { latitude: 20.62, longitude: -103.35 },
    b = { latitude: 20.7, longitude: -103.4 };
  it("uses actual departure for forecasts and never invents historical traffic", () => {
    const departure = "2026-09-10T14:00:00.000Z",
      now = Date.parse(departure);
    expect(roadRequest(a, b, departure, now - 1)).toMatchObject({
      origin: { location: { latLng: a } },
      destination: { location: { latLng: b } },
      departureTime: departure,
      routingPreference: "TRAFFIC_AWARE",
      travelMode: "DRIVE",
      computeAlternativeRoutes: false,
      polylineQuality: "HIGH_QUALITY",
      languageCode: "es-MX",
      units: "METRIC",
    });
    for (const value of [now, now + 1]) {
      const request = roadRequest(a, b, departure, value);
      expect(request).toMatchObject({
        routingPreference: "TRAFFIC_UNAWARE",
        travelMode: "DRIVE",
      });
      expect(request).not.toHaveProperty("departureTime");
    }
  });
  it.each([NaN, Infinity, -Infinity, 90.01, -90.01])(
    "rejects invalid latitude %s",
    (latitude) => {
      expect(() =>
        roadRequest({ ...a, latitude }, b, "2026-09-10T14:00:00Z", 0),
      ).toThrow("ROUTING_POINTS_REQUIRED");
    },
  );
  it.each([NaN, Infinity, -Infinity, 180.01, -180.01])(
    "rejects invalid longitude %s",
    (longitude) => {
      expect(() =>
        roadRequest(a, { ...b, longitude }, "2026-09-10T14:00:00Z", 0),
      ).toThrow("ROUTING_POINTS_REQUIRED");
    },
  );
  it("validates date and accepts geographic bounds", () => {
    expect(() => roadRequest(a, b, "bad", 0)).toThrow("ROUTING_MODEL_INVALID");
    expect(() => roadRequest(a, b, "2026-09-10T14:00:00Z", NaN)).toThrow(
      "ROUTING_MODEL_INVALID",
    );
    expect(
      roadRequest(
        { latitude: -90, longitude: -180 },
        { latitude: 90, longitude: 180 },
        "2026-09-10T14:00:00Z",
        0,
      ),
    ).toHaveProperty("destination");
  });
  it("parses the provider wire format without exposing a token in road geometry", () => {
    const payload = {
      routes: [
        {
          distanceMeters: 123,
          duration: "30.1s",
          polyline: { encodedPolyline: "abc" },
          routeToken: "private",
        },
      ],
    };
    expect(parseRoadLeg(payload, true)).toEqual({
      distance: 123,
      seconds: 31,
      polyline: "abc",
      token: "private",
      trafficMode: "forecast",
    });
    expect(
      parseRoadLeg(
        {
          routes: [
            {
              distanceMeters: 0,
              duration: "0s",
              polyline: { encodedPolyline: "p" },
            },
          ],
        },
        false,
      ),
    ).toEqual({
      distance: 0,
      seconds: 0,
      polyline: "p",
      token: null,
      trafficMode: "static",
    });
  });
  it.each([
    null,
    {},
    { routes: [] },
    { routes: [{}, {}] },
    { routes: [{}] },
    {
      routes: [
        {
          distanceMeters: 1,
          duration: "1s",
          polyline: { encodedPolyline: "first" },
        },
        {
          distanceMeters: 2,
          duration: "2s",
          polyline: { encodedPolyline: "second" },
        },
      ],
    },
    ...[-1, 1.2, Infinity].map((distanceMeters) => ({
      routes: [
        { distanceMeters, duration: "1s", polyline: { encodedPolyline: "p" } },
      ],
    })),
    ...["bad", "-1s", "NaNs", 1].map((duration) => ({
      routes: [
        { distanceMeters: 1, duration, polyline: { encodedPolyline: "p" } },
      ],
    })),
    {
      routes: [
        {
          distanceMeters: 1,
          duration: "1x",
          polyline: { encodedPolyline: "p" },
        },
      ],
    },
    {
      routes: [
        {
          distanceMeters: 1,
          duration: "1s",
          polyline: { encodedPolyline: { length: 1 } },
        },
      ],
    },
    {
      routes: [
        {
          distanceMeters: 1,
          duration: "1s",
          polyline: { encodedPolyline: "" },
        },
      ],
    },
  ])("rejects incomplete road responses %j", (value) => {
    expect(() => parseRoadLeg(value, true)).toThrow("ROUTING_RESPONSE_INVALID");
  });
});

describe("manual schedule arithmetic", () => {
  it("waits for an opening and chooses the next available window", () => {
    expect(visitTiming(1000, [{ start: 5000, end: 10000 }])).toEqual({
      eta: 5000,
      waitDurationSeconds: 4,
      lateSeconds: 0,
    });
    expect(
      visitTiming(11000, [
        { start: 15000, end: 20000 },
        { start: 5000, end: 10000 },
      ]),
    ).toEqual({ eta: 15000, waitDurationSeconds: 4, lateSeconds: 0 });
    expect(
      visitTiming(3000, [
        { start: 15000, end: 20000 },
        { start: 5000, end: 10000 },
      ]),
    ).toEqual({ eta: 5000, waitDurationSeconds: 2, lateSeconds: 0 });
  });
  it("accepts the exact closing instant; reports lateness and keeps arrival rather than changing order", () => {
    const windows = [{ start: 5000, end: 10000 }];
    expect(visitTiming(10000, windows)).toEqual({
      eta: 10000,
      waitDurationSeconds: 0,
      lateSeconds: 0,
    });
    expect(
      visitTiming(10000, [
        { start: 5000, end: 10000 },
        { start: 20000, end: 30000 },
      ]),
    ).toEqual({
      eta: 10000,
      waitDurationSeconds: 0,
      lateSeconds: 0,
    });
    expect(visitTiming(10001, windows)).toEqual({
      eta: 10001,
      waitDurationSeconds: 0,
      lateSeconds: 1,
    });
    expect(visitTiming(10000, [])).toEqual({
      eta: 10000,
      waitDurationSeconds: 0,
      lateSeconds: 0,
    });
  });
  it("rejects invalid clocks and reversed windows", () => {
    expect(() => visitTiming(NaN, [])).toThrow("ROUTING_MODEL_INVALID");
    for (const window of [
      { start: NaN, end: 2 },
      { start: 0, end: Infinity },
      { start: 2, end: 1 },
    ])
      expect(() => visitTiming(0, [window])).toThrow("ROUTING_MODEL_INVALID");
    expect(visitTiming(1, [{ start: 1, end: 1 }]).eta).toBe(1);
  });
});
