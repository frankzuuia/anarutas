import { trackingPolicy } from "./live-tracking-contract";
import type { LiveRoute } from "./live-routes";

type DestinationRoute = Pick<LiveRoute, "completedAt" | "targetStopId" | "arrivedStopId" | "warehouseDestination" | "location">;

export function warehouseReturnStatus(route: DestinationRoute, now: number): "active" | "stale" | null {
  if (!route.warehouseDestination || route.completedAt || route.targetStopId || route.arrivedStopId || route.location?.stopped) return null;
  const age = now - Date.parse(route.warehouseDestination.observedAt);
  return Number.isFinite(age) && age >= 0 && age <= trackingPolicy.freshSeconds * 1000 ? "active" : "stale";
}

export function routeDestinationLabel(route: DestinationRoute & Pick<LiveRoute, "stops">, now: number) {
  if (route.completedAt) return "Ruta terminada";
  const warehouse = warehouseReturnStatus(route, now);
  if (warehouse) return warehouse === "active" ? "De regreso a bodega" : "Regreso a bodega · sin confirmación reciente";
  const active = route.stops.find(stop => stop.id === (route.arrivedStopId ?? route.targetStopId));
  return active ? `${route.arrivedStopId ? "Atendiendo" : "Destino"}: ${active.position} · ${active.customer}` : "Sin destino confirmado";
}
