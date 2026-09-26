import { describe, expect, it } from "vitest";
import { selectRouteMapView } from "../src/core/route-map-selection";
import type {
  PublicOptimization,
  PublicOptimizedRoute,
} from "../src/core/routing-contract";

const shipments = [
  { id: "one", vehicle_id: "truck-a" },
  { id: "two", vehicle_id: "truck-a" },
  { id: "three", vehicle_id: "truck-b" },
  { id: "waiting", vehicle_id: null },
];
const board = {
  plan: { id: "plan", version: 15 },
  vehicles: [{ id: "truck-a" }, { id: "truck-b" }],
  shipments,
};
const metrics = {
  travelDistanceMeters: 1000,
  travelDurationSeconds: 120,
  waitDurationSeconds: 0,
  totalDurationSeconds: 120,
  performedShipmentCount: 1,
};
const route = (vehicleId: string, ids: string[]): PublicOptimizedRoute => ({
  vehicleId,
  vehicleName: vehicleId,
  encodedPolyline: null,
  metrics,
  stops: ids.map((shipmentId, index) => ({
    shipmentId,
    position: index + 1,
    eta: "2026-09-25T16:00:00Z",
    travelDistanceMeters: 500,
    travelDurationSeconds: 60,
    waitDurationSeconds: 0,
  })),
});
const optimization: PublicOptimization = {
  runId: "run",
  planId: "plan",
  appliedPlanVersion: 15,
  current: true,
  createdAt: "2026-09-25T15:00:00Z",
  metrics,
  skipped: [],
  routes: [route("truck-a", ["one", "two"]), route("truck-b", ["three"])],
};

describe("current assignments are the only source of route map stops", () => {
  it("shows assigned orders only in all-trucks and specific truck filters", () => {
    expect(selectRouteMapView(board, optimization, "all")).toEqual({
      shipments: shipments.slice(0, 3),
      routes: optimization.routes,
    });
    expect(selectRouteMapView(board, optimization, "truck-a")).toEqual({
      shipments: shipments.slice(0, 2),
      routes: [optimization.routes[0]],
    });
    expect(selectRouteMapView(board, optimization, "truck-b")).toEqual({
      shipments: [shipments[2]],
      routes: [optimization.routes[1]],
    });
    expect(selectRouteMapView(board, optimization, "unknown")).toEqual({
      shipments: [],
      routes: [],
    });
  });

  it("unassigned is an explicit view without a route, and never deletes orders", () => {
    const original = structuredClone(board);
    expect(selectRouteMapView(board, optimization, "unassigned")).toEqual({
      shipments: [shipments[3]],
      routes: [],
    });
    const removed = {
      ...board,
      shipments: shipments.map((s) => ({ ...s, vehicle_id: null })),
    };
    for (const filter of ["all", "truck-a", "truck-b"]) {
      expect(selectRouteMapView(removed, optimization, filter)).toEqual({
        shipments: [],
        routes: [],
      });
    }
    expect(
      selectRouteMapView(removed, optimization, "unassigned").shipments,
    ).toEqual(removed.shipments);
    expect(board).toEqual(original);
    expect(
      selectRouteMapView({ ...board, shipments: [] }, optimization, "all"),
    ).toEqual({ shipments: [], routes: [] });
  });

  it("removes an old truck overlay when an order moves or its truck is removed", () => {
    const moved = {
      ...board,
      shipments: shipments.map((s) =>
        s.id === "one" ? { ...s, vehicle_id: "truck-b" } : s,
      ),
    };
    expect(selectRouteMapView(moved, optimization, "truck-a")).toEqual({
      shipments: [shipments[1]],
      routes: [],
    });
    expect(
      selectRouteMapView(moved, optimization, "truck-b").shipments.map(
        (s) => s.id,
      ),
    ).toEqual(["one", "three"]);
    expect(selectRouteMapView(moved, optimization, "all").routes).toEqual([]);
    const withoutTruck = { ...board, vehicles: [board.vehicles[1]] };
    expect(selectRouteMapView(withoutTruck, optimization, "all")).toEqual({
      shipments: [shipments[2]],
      routes: [optimization.routes[1]],
    });
    expect(selectRouteMapView(withoutTruck, optimization, "truck-a")).toEqual({
      shipments: [],
      routes: [],
    });
  });

  it("ignores empty routes and any order or sequence mismatch even at the same version", () => {
    for (const routeA of [
      route("truck-a", []),
      route("truck-a", ["one"]),
      route("truck-a", ["two", "one"]),
      route("truck-a", ["one", "waiting"]),
      route("truck-a", ["one", "two", "waiting"]),
    ]) {
      expect(
        selectRouteMapView(board, { ...optimization, routes: [routeA] }, "all")
          .routes,
      ).toEqual([]);
    }
    const emptyTruck = {
      ...board,
      vehicles: [...board.vehicles, { id: "empty" }],
    };
    expect(
      selectRouteMapView(
        emptyTruck,
        { ...optimization, routes: [route("empty", [])] },
        "empty",
      ),
    ).toEqual({ shipments: [], routes: [] });
  });

  it("never overlays another plan or a stale/future calculation on a newer board snapshot", () => {
    for (const calculation of [
      null,
      { ...optimization, current: false },
      { ...optimization, planId: "other" },
      { ...optimization, appliedPlanVersion: 14 },
      { ...optimization, appliedPlanVersion: 16 },
    ]) {
      const result = selectRouteMapView(board, calculation, "all");
      expect(result.shipments).toEqual(shipments.slice(0, 3));
      expect(result.routes).toEqual([]);
    }
  });
});
