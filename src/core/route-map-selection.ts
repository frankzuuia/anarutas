import type { PublicOptimization } from "./routing-contract";

type MapShipment = { id: string; vehicle_id: string | null };
type MapBoard<T> = {
  plan: { id: string; version: number };
  vehicles: { id: string }[];
  shipments: T[];
};

/** One source for markers, sidebar, totals and lines, based on current assignments. */
export function selectRouteMapView<T extends MapShipment>(
  board: MapBoard<T>,
  optimization: PublicOptimization | null,
  filter: string,
) {
  const vehicleIds = new Set(board.vehicles.map((vehicle) => vehicle.id));
  const shipments = board.shipments.filter((shipment) => {
    if (filter === "unassigned") return shipment.vehicle_id === null;
    return (
      shipment.vehicle_id !== null &&
      vehicleIds.has(shipment.vehicle_id) &&
      (filter === "all" || shipment.vehicle_id === filter)
    );
  });
  // Parallel HTTP reads may straddle an edit; never reuse an older route overlay.
  const current =
    optimization?.current &&
    optimization.planId === board.plan.id &&
    optimization.appliedPlanVersion === board.plan.version;
  const routes = (current ? optimization.routes : []).filter((route) => {
    const assigned = shipments.filter(
      (shipment) => shipment.vehicle_id === route.vehicleId,
    );
    return (
      assigned.length > 0 &&
      assigned.length === route.stops.length &&
      assigned.every(
        (shipment, index) => shipment.id === route.stops[index].shipmentId,
      )
    );
  });
  return { shipments, routes };
}
