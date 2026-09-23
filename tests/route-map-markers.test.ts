import { describe, expect, it } from "vitest";
import {
  groupRouteMapStops,
  nextOpenMarker,
} from "../src/core/route-map-markers";

const stop = (
  id: string,
  partnerId: number,
  stopNumber: number,
  lat = 20,
  lng = -103,
  vehicleId: string | null = "unit-a",
) => ({
  shipment: { id, partnerId, vehicle_id: vehicleId },
  position: { lat, lng },
  stopNumber,
});

describe("route map marker identity", () => {
  it("shows stop numbers instead of calling distinct customers one order group", () => {
    const groups = groupRouteMapStops([
      stop("cocos", 132, 11),
      stop("metate", 75, 15),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("11 / 15");
    expect(groups[0].stops.map((item) => item.shipment.id)).toEqual([
      "cocos",
      "metate",
    ]);
  });

  it("retains the order count only for multiple orders of one customer", () => {
    expect(
      groupRouteMapStops([stop("one", 44, 2), stop("two", 44, 3)])[0].label,
    ).toBe("2 pedidos");
    expect(
      groupRouteMapStops([stop("one", 44, 2), stop("far", 75, 4, 21)])[0].label,
    ).toBe("2");
  });

  it("identifies two trucks serving the exact same coordinates without moving the point", () => {
    const groups = groupRouteMapStops([
      stop("S00001", 44, 1, 20.673, -103.348, "ford-2026"),
      stop("S00004", 44, 1, 20.673, -103.348, "ford-2025"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      position: { lat: 20.673, lng: -103.348 },
      label: "2 pedidos · 2 camionetas",
    });
    expect(groups[0].stops.map((stop) => stop.shipment.vehicle_id))
      .toEqual(["ford-2026", "ford-2025"]);
    expect(groupRouteMapStops([
      stop("S00001", 44, 1, 20.673, -103.348, "ford-2026"),
    ])[0].label).toBe("1");
  });

  it("toggles the same marker closed and switches between different markers", () => {
    expect(nextOpenMarker(null, "xokol")).toBe("xokol");
    expect(nextOpenMarker("xokol", "xokol")).toBeNull();
    expect(nextOpenMarker("xokol", "nejayote")).toBe("nejayote");
  });
});
