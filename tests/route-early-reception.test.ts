import { describe, expect, it } from "vitest";
import { buildDirectFleetRequest } from "../src/core/route-google-direct";
import { consecutiveServiceSeconds } from "../src/core/route-service-time";
import { visitTiming } from "../src/core/route-road";
import { zoneBoard, zoneSettings, zoneShipment } from "./helpers/zone-board";

describe("early reception and indivisible physical destinations", () => {
  it("allows 09:00 before a 10:00 opening without a fabricated wait", () => {
    const s = zoneShipment(1, {
      deliveryWindows: [{ startMinute: 600, endMinute: 720 }],
    });
    const { request } = buildDirectFleetRequest(
      zoneBoard([s]),
      zoneSettings,
      "UTC",
    );
    expect(request.model.shipments[0].deliveries[0].timeWindows).toEqual([
      {
        startTime: "2026-10-02T08:00:00.000Z",
        endTime: "2026-10-02T12:00:00.000Z",
      },
    ]);
    expect(
      visitTiming(9 * 3600000, [{ start: 10 * 3600000, end: 12 * 3600000 }]),
    ).toEqual({
      eta: 9 * 3600000,
      waitDurationSeconds: 0,
      lateSeconds: 0,
    });
  });

  it.each([1, 4, 5, 6])(
    "keeps different windows at one point in one visit with %i trucks",
    (count) => {
      const shipments = [
        zoneShipment(1, {
          unloadingMinutes: 10,
          deliveryWindows: [{ startMinute: 540, endMinute: 660 }],
        }),
        zoneShipment(2, {
          unloadingMinutes: 15,
          deliveryWindows: [{ startMinute: 720, endMinute: 780 }],
        }),
        zoneShipment(3, { unloadingMinutes: 5 }),
        zoneShipment(4, { latitude: 20.65001 }),
      ];
      const { groups, request } = buildDirectFleetRequest(
        zoneBoard(shipments, count),
        zoneSettings,
        "UTC",
      );
      expect(groups).toHaveLength(2);
      expect(groups[0].shipmentIds).toEqual(["s1", "s2", "s3"]);
      expect(request.model.shipments[0]).toMatchObject({
        loadDemands: { orders: { amount: "3" }, destinations: { amount: "1" } },
        deliveries: [
          {
            duration: "1800s",
            timeWindows: [
              {
                startTime: "2026-10-02T08:00:00.000Z",
                endTime: "2026-10-02T11:00:00.000Z",
              },
            ],
          },
          {},
        ],
      });
      expect(request.model.vehicles).toHaveLength(count);
      expect(shipments.map((s) => s.partnerId)).toEqual([1, 2, 3, 4]);
    },
  );

  it("uses each client's final closing before choosing the shared strictest closing", () => {
    const shipments = [
      zoneShipment(1, {
        deliveryWindows: [
          { startMinute: 480, endMinute: 540 },
          { startMinute: 720, endMinute: 840 },
        ],
      }),
      zoneShipment(2, {
        deliveryWindows: [{ startMinute: 600, endMinute: 780 }],
      }),
    ];
    const { request } = buildDirectFleetRequest(
      zoneBoard(shipments),
      zoneSettings,
      "UTC",
    );
    expect(request.model.shipments).toHaveLength(1);
    expect(
      request.model.shipments[0].deliveries[0].timeWindows![0].endTime,
    ).toBe("2026-10-02T13:00:00.000Z");
    expect(
      visitTiming(11 * 3600000, [
        { start: 8 * 3600000, end: 9 * 3600000 },
        { start: 12 * 3600000, end: 14 * 3600000 },
      ]),
    ).toEqual({
      eta: 11 * 3600000,
      waitDurationSeconds: 0,
      lateSeconds: 0,
    });
  });

  it("does not duplicate service for the same customer's orders with different recorded windows", () => {
    const shipments = [
      zoneShipment(1, {
        partnerId: 1,
        unloadingMinutes: 10,
        deliveryWindows: [{ startMinute: 540, endMinute: 660 }],
      }),
      zoneShipment(2, {
        partnerId: 1,
        unloadingMinutes: 10,
        deliveryWindows: [],
      }),
      zoneShipment(3, { unloadingMinutes: 15 }),
      zoneShipment(4, { latitude: 20.66, unloadingMinutes: 3 }),
      zoneShipment(5, { partnerId: 1, unloadingMinutes: 10 }),
    ];
    expect([...consecutiveServiceSeconds(shipments)]).toEqual([
      ["s3", 1500],
      ["s4", 180],
      ["s5", 600],
    ]);
  });
});
