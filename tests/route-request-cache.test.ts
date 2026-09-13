import { describe, expect, it } from "vitest";
import {
  createRequestCache,
  roadLegCacheKey,
} from "../src/core/route-request-cache";

describe("request-local read cache / pure async computations", () => {
  it("shares concurrent work, isolates request scopes and evicts failed reads", async () => {
    const read = createRequestCache<number>();
    let operations = 0;
    const calculate = async () => ++operations;
    const first = read("same", calculate);
    const simultaneous = read("same", calculate);
    expect(simultaneous).toBe(first);
    expect(await Promise.all([first, simultaneous])).toEqual([1, 1]);
    expect(await read("same", calculate)).toBe(1);
    expect(await read("different", calculate)).toBe(2);
    expect(await createRequestCache<number>()("same", calculate)).toBe(3);
    const failure = new Error("read failed");
    await expect(
      read("failed", () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await read("failed", calculate)).toBe(4);
    expect(await read("failed", calculate)).toBe(4);
    expect(await read("same", calculate)).toBe(1);
    expect(operations).toBe(4);
  });

  it("distinguishes direction, every coordinate, departure and forecast mode", () => {
    const from = { latitude: 20, longitude: -103 };
    const to = { latitude: 21, longitude: -102 };
    const departure = "2026-09-12T08:00:00Z";
    const instant = Date.parse(departure);
    const original = roadLegCacheKey(from, to, departure, instant - 1);
    expect(JSON.parse(original)).toEqual([
      20,
      -103,
      21,
      -102,
      departure,
      "forecast",
    ]);
    expect(JSON.parse(roadLegCacheKey(from, to, departure, instant))).toEqual([
      20,
      -103,
      21,
      -102,
      departure,
      "static",
    ]);
    expect(
      roadLegCacheKey({ ...from }, { ...to }, departure, instant - 2),
    ).toBe(original);
    const variations = [
      roadLegCacheKey({ ...from, latitude: 22 }, to, departure, instant - 1),
      roadLegCacheKey({ ...from, longitude: -104 }, to, departure, instant - 1),
      roadLegCacheKey(from, { ...to, latitude: 22 }, departure, instant - 1),
      roadLegCacheKey(from, { ...to, longitude: -104 }, departure, instant - 1),
      roadLegCacheKey(to, from, departure, instant - 1),
      roadLegCacheKey(from, to, "2026-09-12T09:00:00Z", instant - 1),
      roadLegCacheKey(from, to, departure, instant),
    ];
    expect(new Set([original, ...variations]).size).toBe(8);
    expect(roadLegCacheKey(from, to, departure, instant + 1)).toBe(
      variations.at(-1),
    );
  });
});
