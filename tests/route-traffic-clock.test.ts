import { describe, expect, it } from "vitest";
import { trafficClock } from "../src/core/route-traffic-clock";
import { parseGoogleOptimizationResponse } from "../src/core/route-optimization-google";

describe("traffic timing deficits from real provider contracts", () => {
  it("carries the observed 228s and 134s deficits without erasing driving time", () => {
    const result = trafficClock(
      [
        { eta: "2026-10-02T16:00:00Z", waitDurationSeconds: -228 },
        { eta: "2026-10-02T17:30:00Z", waitDurationSeconds: -134 },
      ],
      "2026-10-02T19:49:32Z",
      0,
    );
    expect(result).toEqual({
      clocks: [
        { eta: "2026-10-02T16:03:48.000Z", waitDurationSeconds: 0 },
        { eta: "2026-10-02T17:36:02.000Z", waitDurationSeconds: 0 },
      ],
      finishedAt: "2026-10-02T19:55:34.000Z",
      waitDurationSeconds: 0,
      addedSeconds: 362,
    });
  });
  it("consumes real slack and includes return-leg waiting and deficits", () => {
    const visits = [
      { eta: "2026-10-02T08:00:00Z", waitDurationSeconds: -60 },
      { eta: "2026-10-02T08:10:00Z", waitDurationSeconds: 90 },
    ];
    expect(trafficClock(visits, "2026-10-02T09:00:00Z", 20)).toEqual({
      clocks: [
        { eta: "2026-10-02T08:01:00.000Z", waitDurationSeconds: 0 },
        { eta: "2026-10-02T08:10:00.000Z", waitDurationSeconds: 30 },
      ],
      finishedAt: "2026-10-02T09:00:00.000Z",
      waitDurationSeconds: 50,
      addedSeconds: 0,
    });
    expect(trafficClock(visits, "2026-10-02T09:00:00Z", -40)).toMatchObject({
      finishedAt: "2026-10-02T09:00:40.000Z",
      waitDurationSeconds: 30,
      addedSeconds: 40,
    });
  });
  it("rejects missing or corrupt clocks", () => {
    for (const time of [undefined, "bad"])
      expect(() => trafficClock([], time, 0)).toThrow(
        "ROUTING_RESPONSE_INVALID",
      );
    expect(() =>
      trafficClock(
        [{ eta: "bad", waitDurationSeconds: 0 }],
        "2026-10-02T09:00:00Z",
        0,
      ),
    ).toThrow("ROUTING_RESPONSE_INVALID");
    expect(() => trafficClock([], "2026-10-02T09:00:00Z", NaN)).toThrow(
      "ROUTING_RESPONSE_INVALID",
    );
  });
  // Pure parser contract based on the signed wait observed in the live receipt.
  // Not an external integration or a replacement for the actual Google replay.
  const response = () => ({
    routes: [
      {
        hasTrafficInfeasibilities: true,
        vehicleStartTime: "2026-10-02T08:00:00Z",
        vehicleEndTime: "2026-10-02T08:20:00Z",
        visits: [{ startTime: "2026-10-02T08:10:00Z" }],
        transitions: [
          {
            travelDuration: "612s",
            waitDuration: "-12s",
            travelDistanceMeters: 1000,
            routePolyline: { points: "in" },
          },
          {
            travelDuration: "600s",
            waitDuration: "0s",
            routePolyline: { points: "out" },
          },
        ],
        metrics: {
          performedShipmentCount: 1,
          travelDuration: "1212s",
          waitDuration: "-12s",
          totalDuration: "1200s",
        },
      },
    ],
    metrics: {
      aggregatedRouteMetrics: {
        performedShipmentCount: 1,
        travelDuration: "1212s",
        waitDuration: "-12s",
        totalDuration: "1200s",
      },
    },
  });
  it("only normalizes an explicitly flagged traffic deficit and keeps all identities and geometry", () => {
    const r = parseGoogleOptimizationResponse(response(), 1, 1);
    expect(r.routes[0]).toMatchObject({
      vehicleIndex: 0,
      finishedAt: "2026-10-02T08:20:12.000Z",
      trafficAdjustmentSeconds: 12,
      visits: [
        {
          shipmentIndex: 0,
          eta: "2026-10-02T08:10:12.000Z",
          travelDurationSeconds: 612,
          waitDurationSeconds: 0,
        },
      ],
      transitions: [{ encodedPolyline: "in" }, { encodedPolyline: "out" }],
      metrics: {
        travelDurationSeconds: 1212,
        totalDurationSeconds: 1212,
        waitDurationSeconds: 0,
      },
    });
    expect(r.metrics).toMatchObject({
      totalDurationSeconds: 1212,
      waitDurationSeconds: 0,
    });
    const unflagged = response();
    unflagged.routes[0].hasTrafficInfeasibilities = false;
    expect(() => parseGoogleOptimizationResponse(unflagged, 1, 1)).toThrow(
      "ROUTING_RESPONSE_INVALID",
    );
  });
  it("never permits negative driving, total duration or malformed waits under the traffic flag", () => {
    for (const bad of ["-1s", "NaNs", "bad"]) {
      const r = response();
      r.routes[0].transitions[0].travelDuration = bad;
      expect(() => parseGoogleOptimizationResponse(r, 1, 1)).toThrow(
        "ROUTING_RESPONSE_INVALID",
      );
    }
    const r = response();
    r.routes[0].metrics.totalDuration = "-1s";
    expect(() => parseGoogleOptimizationResponse(r, 1, 1)).toThrow(
      "ROUTING_RESPONSE_INVALID",
    );
  });
  it("requires the return transition and accepts omitted protobuf zero wait", () => {
    const missing = response();
    missing.routes[0].transitions.pop();
    expect(() => parseGoogleOptimizationResponse(missing, 1, 1)).toThrow(
      "ROUTING_RESPONSE_INVALID",
    );
    const r = response();
    Reflect.deleteProperty(r.routes[0].transitions[1], "waitDuration");
    expect(
      parseGoogleOptimizationResponse(r, 1, 1).routes[0]
        .trafficAdjustmentSeconds,
    ).toBe(12);
  });
});
