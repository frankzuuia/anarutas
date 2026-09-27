import { trackingPolicy } from "./live-tracking-contract";
import type { LiveRoute } from "./live-routes";

export type LiveEta = { targetStopId: string; state: "ready" | "calculating" | "unavailable";
  remainingSeconds: number | null; observedAt: string };

export function routeEta(route: Pick<LiveRoute, "targetStopId" | "arrivedStopId" | "eta" | "location">, now: number) {
  if (route.arrivedStopId && (!route.targetStopId || route.arrivedStopId === route.targetStopId)) return "En atención";
  if (!route.targetStopId) return "Sin destino activo";
  const eta = route.eta;
  if (!eta || eta.targetStopId !== route.targetStopId) return "Tiempo no disponible";
  const age = now - Date.parse(eta.observedAt);
  const gpsAge = route.location ? now - Date.parse(route.location.observedAt) : Infinity;
  if (!Number.isFinite(age) || age < 0 || age > trackingPolicy.freshSeconds * 1000 ||
      !Number.isFinite(gpsAge) || gpsAge < 0 || gpsAge > trackingPolicy.freshSeconds * 1000 || route.location!.stopped)
    return "Tiempo desactualizado";
  if (eta.state === "calculating") return "Calculando…";
  if (eta.state !== "ready" || eta.remainingSeconds === null) return "Tiempo no disponible";
  return eta.remainingSeconds < 60 ? "<1 min" : `≈${Math.ceil(eta.remainingSeconds / 60)} min`;
}
