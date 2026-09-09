import { describe, expect, it } from "vitest";
import {
  dayAfter,
  importRange,
  integer,
  localMidnight,
  maxManualOrderNames,
  orderNames,
  uuid,
  vehicleIds,
} from "../src/core/orders-validation";
import { todayInTimezone } from "../src/core/local-date";

describe("order import boundaries", () => {
  it("uses today's civil date in the configured timezone", () => {
    const instant = new Date("2026-09-10T05:30:00.000Z");
    expect(todayInTimezone("America/Mexico_City", instant)).toBe("2026-09-09");
    expect(todayInTimezone("UTC", instant)).toBe("2026-09-10");
  });
  it("converts local Mexico dates to UTC half-open boundaries", () => {
    expect(localMidnight("2026-09-08", "America/Mexico_City")).toBe(
      "2026-09-08 06:00:00",
    );
    expect(
      importRange(
        { from: "2026-09-08", to: "2026-09-08" },
        "America/Mexico_City",
      ),
    ).toEqual({
      from: "2026-09-08",
      to: "2026-09-08",
      start: "2026-09-08 06:00:00",
      end: "2026-09-09 06:00:00",
    });
    expect(dayAfter("2028-02-28")).toBe("2028-02-29");
    expect(dayAfter("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayAfter("2026-09-08", 0)).toBe("2026-09-08");
    expect(localMidnight("2026-09-08", "UTC")).toBe("2026-09-08 00:00:00");
    expect(localMidnight("2026-03-08", "America/New_York")).toBe(
      "2026-03-08 05:00:00",
    );
    expect(() => localMidnight("2011-12-30", "Pacific/Apia")).toThrow(
      "DATE_BOUNDARY_UNSUPPORTED",
    );
  });
  it("rejects reversed ranges and duplicate or invalid fleet identifiers", () => {
    expect(() =>
      importRange({ from: "2026-09-09", to: "2026-09-08" }, "UTC"),
    ).toThrow("INVALID_DATE");
    const id = "00000000-0000-4000-8000-000000000001";
    expect(() => vehicleIds([id, id])).toThrow("INVALID_INPUT");
    expect(() => vehicleIds(["bad"])).toThrow("INVALID_INPUT");
    expect(() => vehicleIds("bad")).toThrow("INVALID_INPUT");
    expect(vehicleIds(["00000000-0000-4000-8000-000000000002", id])).toEqual([
      id,
      "00000000-0000-4000-8000-000000000002",
    ]);
  });
  it("accepts only bounded integers and canonical UUID shapes", () => {
    expect(integer(0)).toBe(0);
    expect(integer(2, 1)).toBe(2);
    for (const value of ["1", 1.5, NaN, Infinity, -1])
      expect(() => integer(value)).toThrow("INVALID_INPUT");
    expect(() => integer(0, 1)).toThrow("INVALID_INPUT");
    const id = "A0000000-0000-4000-8000-000000000001";
    expect(uuid(id)).toBe(id);
    for (const value of [
      null,
      1,
      "a00000000000-4000-8000-000000000001",
      "a000000-00000-4000-8000-000000000001",
      "a0000000-0000-4000-8000-00000000000z",
      "a0000000_0000-4000-8000-000000000001",
    ])
      expect(() => uuid(value)).toThrow("INVALID_INPUT");
  });
  it("normalizes bounded exact S folios and rejects ambiguity", () => {
    expect(orderNames([" s00001 ", "S123456"])).toEqual(["S00001", "S123456"]);
    expect(
      orderNames(
        Array.from({ length: maxManualOrderNames }, (_, i) => `S${i}`),
      ),
    ).toHaveLength(maxManualOrderNames);
    expect(orderNames([`S${"1".repeat(20)}`])).toEqual([`S${"1".repeat(20)}`]);
    for (const value of [
      [],
      "S00001",
      [1],
      [""],
      ["S"],
      ["00001"],
      ["S1A"],
      [`S${"1".repeat(21)}`],
      Array.from({ length: maxManualOrderNames + 1 }, (_, i) => `S${i}`),
    ])
      expect(() => orderNames(value)).toThrow("MANUAL_ORDERS_INVALID");
    expect(() => orderNames(["S00001", "s00001"])).toThrow(
      "MANUAL_ORDERS_DUPLICATED",
    );
  });
});
