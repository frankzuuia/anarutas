import { describe, expect, it } from "vitest";
import { buildDirectFleetRequest } from "../src/core/route-google-direct";
import { zoneBoard, zoneSettings, zoneShipment } from "./helpers/zone-board";

// Pure input/model contracts; no simulated provider, network or solver results.
function model(
  windows: { startMinute: number; endMinute: number }[],
  departure = 480,
) {
  const board = zoneBoard(
    [zoneShipment(1, { deliveryWindows: windows, unloadingMinutes: 15 })],
    1,
  );
  board.plan.departure_minute = departure;
  return buildDirectFleetRequest(board, zoneSettings, "UTC").request;
}
function choices(
  windows: { startMinute: number; endMinute: number }[],
  departure = 480,
) {
  return model(windows, departure).model.shipments[0].deliveries;
}
describe("deadline exceptions are explicit visit alternatives", () => {
  it("offers the real window for free and charges even a one-second lateness", () => {
    const options = choices([{ startMinute: 480, endMinute: 600 }]);
    expect(options).toHaveLength(2);
    expect(options[0].timeWindows).toEqual([
      {
        startTime: "2026-10-02T08:00:00.000Z",
        endTime: "2026-10-02T10:00:00.000Z",
      },
    ]);
    expect(options[0]).not.toHaveProperty("cost");
    expect(options[1]).toMatchObject({
      cost: 18,
      timeWindows: [
        {
          startTime: "2026-10-02T10:00:00.000Z",
          softEndTime: "2026-10-02T10:00:00.000Z",
          costPerHourAfterSoftEndTime: 9,
        },
      ],
    });
    expect(Date.parse(options[1].timeWindows![0].endTime)).toBeGreaterThan(
      Date.parse(options[1].timeWindows![0].startTime),
    );
    expect(
      options.every(
        (v) =>
          v.duration === "900s" &&
          v.label === "s1" &&
          v.tags![0] === "priority:schedule",
      ),
    ).toBe(true);
    expect(options[0].arrivalLocation).toEqual(options[1].arrivalLocation);
  });
  it("permits early reception before the last window without waiting in a gap", () => {
    const options = choices([
      { startMinute: 480, endMinute: 540 },
      { startMinute: 720, endMinute: 780 },
    ]);
    expect(options).toHaveLength(2);
    expect(
      options.filter((v) => !("cost" in v)).map((v) => v.timeWindows![0]),
    ).toEqual([
      {
        startTime: "2026-10-02T08:00:00.000Z",
        endTime: "2026-10-02T13:00:00.000Z",
      },
    ]);
    expect(
      options
        .filter((v) => "cost" in v)
        .map((v) => (v as { cost: number }).cost),
    ).toEqual([45]);
  });
  it("never manufactures an on-time window after the customer closed", () => {
    const request = model(
      [
        { startMinute: 420, endMinute: 480 },
        { startMinute: 600, endMinute: 660 },
      ],
      720,
    );
    const options = request.model.shipments[0].deliveries;
    expect(options).toHaveLength(1);
    expect(options).toMatchObject([{ cost: 18 }]);
    for (const v of options) {
      expect(v.timeWindows![0].startTime).toBe(request.model.globalStartTime);
      expect(v.timeWindows![0].softEndTime).toBe(request.model.globalStartTime);
      expect(v.timeWindows![0].endTime).toBe(request.model.globalEndTime);
    }
    expect(request.model.shipments[0]).not.toHaveProperty("penaltyCost");
  });
  it("retains an exact closing-time arrival and clips an opening before departure", () => {
    const atClosing = choices([{ startMinute: 420, endMinute: 480 }]);
    expect(atClosing).toHaveLength(2);
    expect(atClosing[0].timeWindows).toEqual([
      {
        startTime: "2026-10-02T08:00:00.000Z",
        endTime: "2026-10-02T08:00:00.000Z",
      },
    ]);
    const clipped = choices([{ startMinute: 420, endMinute: 600 }]);
    expect(clipped[0].timeWindows![0].startTime).toBe(
      "2026-10-02T08:00:00.000Z",
    );
  });
  it("adds no artificial deadline or penalty when no schedule exists", () => {
    const options = choices([]);
    expect(options).toHaveLength(1);
    expect(options[0]).not.toHaveProperty("cost");
    expect(options[0]).not.toHaveProperty("timeWindows");
  });
  it("normalizes overlapping, adjacent and repeated windows to the final reception deadline", () => {
    const options = choices([
      { startMinute: 480, endMinute: 600 },
      { startMinute: 540, endMinute: 660 },
      { startMinute: 660, endMinute: 720 },
      { startMinute: 480, endMinute: 600 },
    ]);
    expect(options).toHaveLength(2);
    expect(options.every((v) => v.timeWindows!.length === 1)).toBe(true);
    expect(
      options
        .filter((v) => !("cost" in v))
        .map((v) => v.timeWindows![0].endTime),
    ).toEqual(["2026-10-02T12:00:00.000Z"]);
  });
});
