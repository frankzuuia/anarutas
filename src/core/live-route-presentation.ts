import type { LiveRoute } from "./live-routes";
import { trackingPolicy } from "./live-tracking-contract";

// vehicleId remains in stored layouts for backwards compatibility, not as a hidden filter.
export function routesForDriver<T extends { driverId: string }>(routes: T[], driverId: string) {
  return routes.filter(route => !driverId || route.driverId === driverId);
}

export function liveMapFrameKey(routes: Pick<LiveRoute, "id" | "location">[], driverId: string, revision: number) {
  // Reframe on the first GPS, not every coordinate update. Keep manual zoom during polling.
  return JSON.stringify([driverId, revision, routes.map(route => [route.id, Boolean(route.location)]).sort()]);
}

export function locationHealth(route: Pick<LiveRoute, "location" | "completedAt">, now: number) {
  if (route.completedAt) return { live: false, label: "Ruta terminada", age: null };
  if (!route.location) return { live: false, label: "Sin ubicación recibida", age: null };
  const age = Math.max(0, Math.floor((now - Date.parse(route.location.observedAt)) / 1000));
  const live = !route.location.stopped && age <= trackingPolicy.freshSeconds;
  return { live, age, label: route.location.stopped ? "Seguimiento detenido" : live ? `GPS · hace ${age} s` : `Última ubicación · hace ${age < 60 ? `${age} s` : `${Math.floor(age / 60)} min`}` };
}
