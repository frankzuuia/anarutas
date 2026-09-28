import { describe, expect, it } from "vitest";
import {
  clockMinute,
  customerInput,
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
          start: { hour: 11, minute: 0 },
          end: { hour: 13, minute: 0 },
        },
      ],
    });
    expect(parsed.windows[0]).toMatchObject({
      startMinute: 660,
      endMinute: 780,
    });
    expect(() =>
      customerInput({
        ...base,
        windows: [
          {
            start: { hour: 9, minute: 0 },
            end: { hour: 12, minute: 0 },
          },
          {
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

  it("validates collection and range boundaries without calendar fields", () => {
    const parse = (value: unknown) =>
      customerInput({ ...base, windows: value });
    for (const value of [null, {}, "11:00", [null], [[]], ["window"]])
      expect(() => parse(value)).toThrow("CUSTOMER_WINDOWS_INVALID");
    expect(() =>
      parse([
        {
          days: [0],
          start: { hour: 11, minute: 0 },
          end: { hour: 13, minute: 0 },
        },
      ]),
    ).toThrow("CUSTOMER_WINDOWS_INVALID");
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
      expect(() => parse([{ start, end }])).toThrow("CUSTOMER_WINDOWS_INVALID");

    const adjacent = parse([
      {
        start: { hour: 11, minute: 0 },
        end: { hour: 13, minute: 0 },
      },
      {
        start: { hour: 13, minute: 0 },
        end: { hour: 14, minute: 0 },
      },
    ]).windows;
    expect(adjacent).toEqual([
      { startMinute: 660, endMinute: 780, position: 1 },
      { startMinute: 780, endMinute: 840, position: 2 },
    ]);
    expect(
      parse([
        {
          start: { hour: 13, minute: 0 },
          end: { hour: 14, minute: 0 },
        },
        {
          start: { hour: 11, minute: 0 },
          end: { hour: 13, minute: 0 },
        },
      ]).windows,
    ).toHaveLength(2);

    const thirtyTwo = Array.from({ length: 32 }, (_, index) => ({
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

  it("rejects overlap regardless of legacy weekdays or input order", () => {
    const parse = (windows: unknown[]) => customerInput({ ...base, windows });
    const early = {
      start: { hour: 9, minute: 0 },
      end: { hour: 12, minute: 0 },
    };
    const late = {
      start: { hour: 11, minute: 30 },
      end: { hour: 13, minute: 0 },
    };
    expect(() => parse([early, late])).toThrow("CUSTOMER_WINDOWS_OVERLAP");
    expect(() => parse([late, early])).toThrow("CUSTOMER_WINDOWS_OVERLAP");
    expect(() => parse([{ ...early, days: [1] }, late])).toThrow(
      "CUSTOMER_WINDOWS_INVALID",
    );
  });

  it("allows only Google HTTPS links and valid coordinates", () => {
    expect(customerInput({ ...base, mapUrl: "" }).mapUrl).toBeNull();
    expect(customerInput({ ...base, mapUrl: undefined }).mapUrl).toBeNull();
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
    expect(() => customerInput({ ...base, mapUrl: "not-a-url" })).toThrow(
      "CUSTOMER_MAP_URL_INVALID",
    );
    expect(() =>
      customerInput({
        ...base,
        location: { latitude: 91, longitude: 0, placeId: null },
      }),
    ).toThrow("INVALID_INPUT");
    expect(mapsUrl(20.6, -103.3)).toContain("query=20.6%2C-103.3");
  });
});
