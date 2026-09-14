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
) => ({
  shipment: { id, partnerId },
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

  it("toggles the same marker closed and switches between different markers", () => {
    expect(nextOpenMarker(null, "xokol")).toBe("xokol");
    expect(nextOpenMarker("xokol", "xokol")).toBeNull();
    expect(nextOpenMarker("xokol", "nejayote")).toBe("nejayote");
  });
});
