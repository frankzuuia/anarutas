import type { Shipment } from "./orders-contract";

type MarkerShipment = Pick<Shipment, "id" | "partnerId" | "vehicle_id">;
type MarkerPosition = { lat: number; lng: number };
type MarkerStop<T extends MarkerShipment> = {
  shipment: T;
  position: MarkerPosition;
  stopNumber: number;
};

export type RouteMapMarkerGroup<T extends MarkerShipment> = {
  key: string;
  position: MarkerPosition;
  stops: MarkerStop<T>[];
  label: string;
};

function markerKey(position: MarkerPosition) {
  return `${position.lat},${position.lng}`;
}

export function groupRouteMapStops<T extends MarkerShipment>(
  stops: MarkerStop<T>[],
): RouteMapMarkerGroup<T>[] {
  const groups = new Map<string, RouteMapMarkerGroup<T>>();
  for (const stop of stops) {
    const key = markerKey(stop.position);
    const current = groups.get(key);
    if (current) current.stops.push(stop);
    else
      groups.set(key, {
        key,
        position: stop.position,
        stops: [stop],
        label: "",
      });
  }
  for (const group of groups.values()) {
    const customers = new Set(
      group.stops.map((stop) => stop.shipment.partnerId),
    );
    const vehicles = new Set(
      group.stops.map((stop) => stop.shipment.vehicle_id),
    );
    const numbers = [...new Set(group.stops.map((stop) => stop.stopNumber))];
    group.label =
      vehicles.size > 1 && !vehicles.has(null)
        ? `${group.stops.length} pedidos · ${vehicles.size} camionetas`
        : group.stops.length > 1 && customers.size === 1
          ? `${group.stops.length} pedidos`
          : numbers.join(" / ");
  }
  return [...groups.values()];
}

export function nextOpenMarker(current: string | null, clicked: string) {
  return current === clicked ? null : clicked;
}
