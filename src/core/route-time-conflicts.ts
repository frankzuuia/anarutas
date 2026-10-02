import type { OrderBoard } from "./orders-contract";
import type { PublicOptimization } from "./routing-contract";
import { selectRouteMapView } from "./route-map-selection";

// Use exactly the route overlay accepted by the map; stale or edited assignments
// must never display timing advice from a different version of the plan.
export function routeTimeConflicts(
  board: OrderBoard,
  optimization: PublicOptimization | null,
  filter = "all",
) {
  const { routes } = selectRouteMapView(board, optimization, filter);
  const shipments = new Map(board.shipments.map((s) => [s.id, s]));
  return routes.flatMap((route) =>
    route.stops.flatMap((stop) => {
      if (!(stop.lateSeconds && stop.lateSeconds > 0)) return [];
      const shipment = shipments.get(stop.shipmentId)!;
      return [
        {
          shipmentId: shipment.id,
          customerName: shipment.customerName,
          orderName: shipment.orderName,
          vehicleName: route.vehicleName,
          eta: stop.eta,
          lateMinutes: Math.ceil(stop.lateSeconds / 60),
          windows: shipment.deliveryWindows,
        },
      ];
    }),
  );
}
