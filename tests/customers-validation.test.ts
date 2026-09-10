import { describe, expect, it } from "vitest";
import {
  clockMinute,
  customerInput,
  maskDays,
  mapsUrl,
  normalizeSearch,
} from "../src/core/customers-validation";

const base = {
  displayName: "Cliente QA",
  phone: "3312345678",
  deliveryNote: "Entregar en recepción",
  priority: "schedule",
  fulfillmentMode: "delivery",
  deliveryAddress: "Av. Vallarta 1, Guadalajara",
  mapUrl: null,
  location: null,
  windows: [],
  expectedVersion: 1,
};

describe("customer validation", () => {
  it("normalizes search and uses unambiguous 24-hour minutes", () => {
    expect(normalizeSearch("  CAFÉ   ÁRBOL ")).toBe("cafe arbol");
    expect(clockMinute({ hour: 11, minute: 0 })).toBe(660);
    expect(clockMinute({ hour: 13, minute: 0 })).toBe(780);
    expect(clockMinute({ hour: 23, minute: 59 })).toBe(1439);
    expect(() => clockMinute({ hour: 24, minute: 0 })).toThrow("INVALID_INPUT");
  });

  it("rejects overlapping windows and accepts 11:00–13:00", () => {
    const parsed = customerInput({
      ...base,
      windows: [
        {
          days: [0, 1, 2, 3, 4],
          start: { hour: 11, minute: 0 },
          end: { hour: 13, minute: 0 },
        },
      ],
    });
    expect(parsed.windows[0]).toMatchObject({
      days: [0, 1, 2, 3, 4],
      startMinute: 660,
      endMinute: 780,
    });
    expect(() =>
      customerInput({
        ...base,
        windows: [
          {
            days: [5],
            start: { hour: 9, minute: 0 },
            end: { hour: 12, minute: 0 },
          },
          {
            days: [5],
            start: { hour: 11, minute: 30 },
            end: { hour: 13, minute: 0 },
          },
        ],
      }),
    ).toThrow("CUSTOMER_WINDOWS_OVERLAP");
  });

  it("rejects every malformed 24-hour clock shape and keeps both boundaries", () => {
    expect(clockMinute({ hour: 0, minute: 0 })).toBe(0);
    expect(clockMinute({ hour: 23, minute: 59 })).toBe(1439);
    for (const value of [
      null,
      [],
      "11:00",
      {},
      { hour: -1, minute: 0 },
      { hour: 0, minute: -1 },
      { hour: 24, minute: 0 },
      { hour: 23, minute: 60 },
      { hour: 11.5, minute: 0 },
      { hour: "11", minute: 0 },
    ])
      expect(() => clockMinute(value)).toThrow("INVALID_INPUT");
  });

  it("validates collection, day and range boundaries without ambiguous time rules", () => {
    const parse = (value: unknown) =>
      customerInput({ ...base, windows: value });
    for (const value of [null, {}, "11:00", [null], [[]], ["window"]])
      expect(() => parse(value)).toThrow("CUSTOMER_WINDOWS_INVALID");
    for (const days of [null, [], [0, 0], [7], [0, 7]])
      expect(() =>
        parse([
          {
            days,
            start: { hour: 11, minute: 0 },
            end: { hour: 13, minute: 0 },
          },
        ]),
      ).toThrow("CUSTOMER_WINDOWS_INVALID");
    for (const days of [[-1], ["0"]])
      expect(() =>
        parse([
          {
            days,
            start: { hour: 11, minute: 0 },
            end: { hour: 13, minute: 0 },
          },
        ]),
      ).toThrow("INVALID_INPUT");
    for (const [start, end] of [
      [
        { hour: 13, minute: 0 },
        { hour: 13, minute: 0 },
      ],
      [
        { hour: 13, minute: 1 },
        { hour: 13, minute: 0 },
      ],
    ])
      expect(() => parse([{ days: [0], start, end }])).toThrow(
        "CUSTOMER_WINDOWS_INVALID",
      );

    const adjacent = parse([
      {
        days: [6, 0],
        start: { hour: 11, minute: 0 },
        end: { hour: 13, minute: 0 },
      },
      {
        days: [0],
        start: { hour: 13, minute: 0 },
        end: { hour: 14, minute: 0 },
      },
    ]).windows;
    expect(adjacent).toEqual([
      { days: [0, 6], startMinute: 660, endMinute: 780, position: 1 },
      { days: [0], startMinute: 780, endMinute: 840, position: 2 },
    ]);
    expect(
      parse([
        {
          days: [0],
          start: { hour: 13, minute: 0 },
          end: { hour: 14, minute: 0 },
        },
        {
          days: [0],
          start: { hour: 11, minute: 0 },
          end: { hour: 13, minute: 0 },
        },
      ]).windows,
    ).toHaveLength(2);

    const thirtyTwo = Array.from({ length: 32 }, (_, index) => ({
      days: [0],
      start: { hour: Math.floor((index * 10) / 60), minute: (index * 10) % 60 },
      end: {
        hour: Math.floor(((index + 1) * 10) / 60),
        minute: ((index + 1) * 10) % 60,
      },
    }));
    expect(parse(thirtyTwo).windows).toHaveLength(32);
    expect(() => parse([...thirtyTwo, thirtyTwo[0]])).toThrow(
      "CUSTOMER_WINDOWS_INVALID",
    );
  });

  it("rejects overlap on any shared day, independently of input order", () => {
    const parse = (windows: unknown[]) => customerInput({ ...base, windows });
    const early = {
      days: [1, 6],
      start: { hour: 9, minute: 0 },
      end: { hour: 12, minute: 0 },
    };
    const late = {
      days: [6],
      start: { hour: 11, minute: 30 },
      end: { hour: 13, minute: 0 },
    };
    expect(() => parse([early, late])).toThrow("CUSTOMER_WINDOWS_OVERLAP");
    expect(() => parse([late, early])).toThrow("CUSTOMER_WINDOWS_OVERLAP");
    expect(
      parse([
        { ...early, days: [1] },
        { ...late, days: [6] },
      ]).windows,
    ).toHaveLength(2);
  });

  it("allows only Google HTTPS links and valid coordinates", () => {
    expect(
      customerInput({
        ...base,
        mapUrl: "https://share.google/example",
        location: {
          latitude: 20.6736,
          longitude: -103.344,
          placeId: "place-qa",
        },
      }).location,
    ).toMatchObject({ latitude: 20.6736, longitude: -103.344 });
    expect(() =>
      customerInput({ ...base, mapUrl: "http://127.0.0.1/admin" }),
    ).toThrow("CUSTOMER_MAP_URL_INVALID");
    expect(() =>
      customerInput({
        ...base,
        location: { latitude: 91, longitude: 0, placeId: null },
      }),
    ).toThrow("INVALID_INPUT");
    expect(mapsUrl(20.6, -103.3)).toContain("query=20.6%2C-103.3");
    expect(maskDays(0b1000011)).toEqual([0, 1, 6]);
  });
});
