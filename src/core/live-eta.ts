import { trackingPolicy } from "./live-tracking-contract";
import type { LiveRoute } from "./live-routes";
import { warehouseReturnStatus } from "./live-route-destination";

export type LiveEta = { targetStopId: string | null; depotVersion?: number; state: "ready" | "calculating" | "unavailable";
  remainingSeconds: number | null; observedAt: string };

export function routeEta(route: Pick<LiveRoute, "targetStopId" | "arrivedStopId" | "eta" | "location" | "completedAt" | "warehouseDestination">, now: number) {
  if (route.completedAt) return "Ruta terminada";
  if (route.arrivedStopId && (!route.targetStopId || route.arrivedStopId === route.targetStopId)) return "En atención";
  const warehouse = warehouseReturnStatus(route, now);
  if (warehouse === "stale") return "Tiempo desactualizado";
  if (!route.targetStopId && !warehouse) return "Sin destino activo";
  const eta = route.eta;
  if (!eta || (warehouse ? eta.targetStopId !== null || eta.depotVersion !== route.warehouseDestination!.depotVersion
    : eta.targetStopId !== route.targetStopId || eta.depotVersion !== undefined)) return "Tiempo no disponible";
  const age = now - Date.parse(eta.observedAt);
  const gpsAge = route.location ? now - Date.parse(route.location.observedAt) : Infinity;
  if (!Number.isFinite(age) || age < 0 || age > trackingPolicy.freshSeconds * 1000 ||
      !Number.isFinite(gpsAge) || gpsAge < 0 || gpsAge > trackingPolicy.freshSeconds * 1000 || route.location!.stopped)
    return "Tiempo desactualizado";
  if (eta.state === "calculating") return "Calculando…";
  if (eta.state !== "ready" || eta.remainingSeconds === null) return "Tiempo no disponible";
  return eta.remainingSeconds < 60 ? "<1 min" : `≈${Math.ceil(eta.remainingSeconds / 60)} min`;
}
