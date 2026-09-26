"use client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { LocateFixed, MapPin, Navigation, Truck, CheckCircle2, AlertTriangle } from "lucide-react";
import type { LiveRoute, LiveStop } from "@/core/live-routes";
import type { ControlScreen } from "@/core/live-tracking-policy";
import type { MapConfig } from "@/core/map-config";
import { trackingPolicy } from "@/core/live-tracking-contract";
import { api } from "./api";
import { loadGoogleMaps } from "./google-maps";
import { useLiveRoutes } from "./use-live-routes";

const statusNames = { open: "Abierto", closed_pending: "Cliente cerrado · reintento", rejected: "Rechazado", rescheduled: "Reprogramado", delivered: "Entregado" };
const colors = ["#8dddac", "#c591ee", "#80bffd", "#f5d676", "#f497bc", "#88ded8"];
export function locationHealth(route: LiveRoute, now: number) {
  if (!route.location) return { live: false, label: "Sin ubicación recibida", age: null };
  const age = Math.max(0, Math.floor((now - Date.parse(route.location.observedAt)) / 1000));
  const live = !route.location.stopped && age <= trackingPolicy.freshSeconds;
  return { live, age, label: route.location.stopped ? "Seguimiento detenido" : live ? `GPS · hace ${age} s` : `Última ubicación · hace ${age < 60 ? `${age} s` : `${Math.floor(age / 60)} min`}` };
}
function RouteProgress({ route, now, selected, onSelect }: { route: LiveRoute; now: number; selected: string; onSelect: (id: string) => void }) {
  const health = locationHealth(route, now);
  const active = route.stops.find(s => s.id === (route.arrivedStopId ?? route.targetStopId));
  return <article className="live-route-card">
    <header><div><h3><Truck size={17} />{route.driver}</h3><p>{route.vehicle} · {route.plate}</p></div><span className={`badge ${health.live ? "green" : "amber"}`}>{health.label}</span></header>
    <div className="small">{route.label} · {route.date}</div>
    <div className="live-progress-counts"><div><strong>{route.progress.delivered}/{route.progress.orders}</strong><span>pedidos entregados</span></div>
      <div><strong>{route.progress.remainingStops}</strong><span>paradas por atender</span></div></div>
    <progress aria-label={`Entregas de ${route.driver}`} value={route.progress.delivered} max={Math.max(1, route.progress.orders)} />
    <p className="live-route-destination"><Navigation size={16} />{active ? `${route.arrivedStopId ? "Atendiendo" : "Destino"}: ${active.position} · ${active.customer}` : "Sin destino confirmado"}</p>
    <p className="small">{route.progress.completedStops}/{route.progress.totalStops} paradas entregadas · {route.progress.rescheduled} pedidos reprogramados · {route.progress.incidentOrders} con incidencia</p>
    {route.location && <p className="small">Precisión ±{Math.round(route.location.accuracy)} m · {new Date(route.location.observedAt).toLocaleTimeString("es-MX")}</p>}
    {route.corrected && <p className="small">Puntos corregidos. El recorrido anterior se omite.</p>}
    <div className="live-stop-list">{route.stops.map(stop => <button className={`live-stop ${selected === stop.id ? "selected" : ""} ${stop.progress.status}`} key={stop.id} onClick={() => onSelect(stop.id)}>
      <span className="live-stop-number">{stop.progress.status === "delivered" ? <CheckCircle2 size={15} /> : stop.progress.status === "incident" ? <AlertTriangle size={15} /> : stop.position}</span>
      <span><strong>{stop.position} · {stop.customer}</strong><small>{stop.orders.map(o => `${o.name} · ${statusNames[o.status]}`).join(" / ")}</small></span>
    </button>)}</div>
  </article>;
}

function LiveMap({ routes, now, filterKey, selected, onSelect, onDriverSelect }: { routes: LiveRoute[]; now: number; filterKey: string; selected: string; onSelect: (id: string) => void; onDriverSelect: (id: string) => void }) {
  const canvas = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [fit, setFit] = useState(0);
  const [follow, setFollow] = useState(false);
  const markers = useRef(new Map<string, { marker: google.maps.marker.AdvancedMarkerElement; node: HTMLButtonElement }>());
  const polylines = useRef<google.maps.Polyline[]>([]);
  const lineKey = useRef("");
  const fitted = useRef("");
  const pick = useEffectEvent(onSelect);
  const pickDriver = useEffectEvent(onDriverSelect);
  useEffect(() => {
    let disposed = false;
    const root = canvas.current!;
    void (async () => {
      try {
        const config = await api<MapConfig>("/api/maps/config");
        if (!config.configured) throw new Error("El mapa no está configurado en esta instalación. El avance de rutas sigue disponible.");
        await loadGoogleMaps(config.browserKey);
        await Promise.all([google.maps.importLibrary("maps"), google.maps.importLibrary("marker"), google.maps.importLibrary("geometry")]);
        if (disposed) return;
        setMap(new google.maps.Map(root, { mapId: config.mapId, mapTypeControl: true, streetViewControl: false, fullscreenControl: false, gestureHandling: "cooperative" })); setError("");
      } catch (e) { if (!disposed) setError((e as Error).message); }
    })();
    const ownedMarkers = markers.current;
    return () => { disposed = true; for (const item of ownedMarkers.values()) item.marker.map = null; ownedMarkers.clear();
      polylines.current.forEach(line => line.setMap(null)); polylines.current = []; lineKey.current = ""; fitted.current = ""; root.replaceChildren(); };
  }, [retry]);
  useEffect(() => {
    if (!map) return;
    const keys = new Set<string>(), bounds = new google.maps.LatLngBounds();
    function marker(id: string, latitude: number, longitude: number, text: string, title: string, className: string, color: string, stopId?: string, driverId?: string) {
      keys.add(id); const position = { lat: latitude, lng: longitude }; bounds.extend(position);
      let item = markers.current.get(id);
      if (!item) {
        const node = document.createElement("button"); node.type = "button";
        if (stopId) node.addEventListener("click", () => pick(stopId));
        if (driverId) node.addEventListener("click", () => pickDriver(driverId));
        const marker = new google.maps.marker.AdvancedMarkerElement({ map, position, content: node, title });
        item = { marker, node }; markers.current.set(id, item);
      }
      item.marker.position = position; item.marker.title = title;
      item.marker.zIndex = className.includes("driver") ? 100 : 10;
      item.node.textContent = text; item.node.className = className; item.node.style.setProperty("--route-color", color); item.node.setAttribute("aria-label", title);
    }
    routes.forEach((route, index) => {
      const color = colors[index % colors.length];
      for (const stop of route.stops) if (stop.progress.visible && stop.latitude !== null && stop.longitude !== null) {
        marker(stop.id, stop.latitude, stop.longitude, `${stop.position}${stop.progress.pending ? " !" : ""}`, `${route.driver} · ${stop.customer}`,
          `live-map-stop ${stop.progress.status} ${stop.id === selected || stop.id === route.targetStopId ? "active" : ""}`, color, stop.id);
      }
      if (route.location) marker(`driver:${route.id}`, route.location.latitude, route.location.longitude, "➤", route.driver,
        `live-map-driver ${locationHealth(route, now).live ? "live" : "stale"}`, color, undefined, route.driverId);
    });
    for (const [id, item] of markers.current) if (!keys.has(id)) {
      // Google Maps owns this imperative object; it is not React state.
      // eslint-disable-next-line react-hooks/immutability
      item.marker.map = null; markers.current.delete(id);
    }
    const nextLineKey = JSON.stringify(routes.map(r => [r.id, r.polylines]));
    if (lineKey.current !== nextLineKey) {
      polylines.current.forEach(line => line.setMap(null)); polylines.current = [];
      for (const [index, route] of routes.entries()) for (const encoded of route.polylines) {
        const line = new google.maps.Polyline({ map, path: google.maps.geometry.encoding.decodePath(encoded), strokeColor: colors[index % colors.length], strokeWeight: 4, strokeOpacity: 0.65 });
        polylines.current.push(line);
      }
      lineKey.current = nextLineKey;
    }
    const fitKey = `${filterKey}:${fit}`;
    // A finished route may have no visible pins and an older APK may supply no GPS.
    // Frame its known addresses without bringing terminal markers back onto the map.
    if (bounds.isEmpty()) for (const route of routes) for (const stop of route.stops) {
      if (stop.latitude !== null && stop.longitude !== null) bounds.extend({ lat: stop.latitude, lng: stop.longitude });
    }
    if (fitted.current !== fitKey && !bounds.isEmpty()) { map.fitBounds(bounds, 56); fitted.current = fitKey; }
    if (follow && routes.length === 1 && routes[0].location) map.panTo({ lat: routes[0].location.latitude, lng: routes[0].location.longitude });
  }, [map, routes, now, filterKey, fit, follow, selected]);
  useEffect(() => {
    const marker = markers.current.get(selected)?.marker;
    if (map && marker?.position) { map.panTo(marker.position as google.maps.LatLngLiteral); if ((map.getZoom() ?? 0) < 14) map.setZoom(14); }
  }, [selected, map]);
  useEffect(() => {
    if (!map || !canvas.current) return;
    const observer = new ResizeObserver(() => google.maps.event.trigger(map, "resize")); observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [map]);
  return <div className="live-map-wrap"><div ref={canvas} className="live-map-canvas" aria-label="Mapa de ubicación de choferes" />
    <div className="live-map-tools"><button className="quiet" onClick={() => setFit(n => n+1)} disabled={!map || !routes.length}><LocateFixed size={16} />Ver todos los puntos</button>
      <button className={`quiet ${follow ? "active" : ""}`} aria-pressed={follow} disabled={!map || routes.length !== 1 || !routes[0]?.location} onClick={() => setFollow(v => !v)}><Navigation size={16} />Seguir chofer</button></div>
    {!map && <div className="live-map-fallback">{error || "Conectando mapa…"}{error && <button className="quiet" onClick={() => setRetry(n => n+1)}>Reintentar mapa</button>}</div>}
    <span className="live-map-caption">Línea: recorrido publicado · Flecha: última ubicación GPS</span>
  </div>;
}

export function LiveRouteView({ feed, filter, onFilter, progressOnly = false }: { feed: ReturnType<typeof useLiveRoutes>; filter: Pick<ControlScreen, "driverId" | "vehicleId">;
  onFilter: (value: Pick<ControlScreen, "driverId" | "vehicleId">) => void; progressOnly?: boolean }) {
  const [selected, setSelected] = useState("");
  const all = feed.report?.routes ?? [];
  const routes = all.filter(r => (!filter.driverId || r.driverId === filter.driverId) && (!filter.vehicleId || r.vehicleId === filter.vehicleId));
  const drivers = [...new Map(all.map(r => [r.driverId, r.driver])).entries()];
  const vehicles = [...new Map(all.map(r => [r.vehicleId, r.vehicle])).entries()];
  const stop: LiveStop | undefined = routes.flatMap(r => r.stops).find(s => s.id === selected);
  return <section className="live-route-view">
    <div className="live-route-filters"><label>Chofer<select aria-label="Chofer" value={filter.driverId} onChange={e => onFilter({ driverId: e.target.value, vehicleId: "" })}>
      <option value="">Todos los choferes</option>{filter.driverId && !drivers.some(([id]) => id === filter.driverId) && <option value={filter.driverId}>Chofer sin ruta activa</option>}
      {drivers.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Camioneta<select aria-label="Camioneta" value={filter.vehicleId} onChange={e => onFilter({ ...filter, vehicleId: e.target.value })}><option value="">Todas las camionetas</option>
        {filter.vehicleId && !vehicles.some(([id]) => id === filter.vehicleId) && <option value={filter.vehicleId}>Camioneta sin ruta activa</option>}
        {vehicles.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <span className={`badge ${feed.error ? "amber" : "green"}`}>{feed.error ? "Reconectando" : feed.report ? "Actualización cada 5 s" : "Conectando"}</span></div>
    {!!routes.length && <div className="live-route-summary" aria-label="Resumen de avance">
      <span><strong>{routes.reduce((n,r) => n+r.progress.delivered,0)}/{routes.reduce((n,r) => n+r.progress.orders,0)}</strong> pedidos entregados</span>
      <span><strong>{routes.reduce((n,r) => n+r.progress.remainingStops,0)}</strong> paradas pendientes</span>
      {routes.length === 1 && <span className={locationHealth(routes[0], feed.now).live ? "gps-live" : "gps-stale"}>{locationHealth(routes[0], feed.now).label}</span>}
    </div>}
    {feed.error && <p className="notice error" role="alert">{feed.error} Se conserva el último corte. <button className="quiet" onClick={feed.refresh}>Reintentar</button></p>}
    {feed.report && !routes.length && <div className="live-empty"><MapPin size={30} /><h3>Sin rutas iniciadas para este filtro</h3><p>Aparecerán al iniciar una ruta. La ubicación requiere la APK con seguimiento habilitado.</p></div>}
    {!feed.report && !feed.error && <p role="status">Consultando rutas…</p>}
    {!!routes.length && <div className={`live-route-content ${progressOnly ? "progress-only" : ""}`}>
      {!progressOnly && <LiveMap routes={routes} now={feed.now} filterKey={JSON.stringify(filter)} selected={selected} onSelect={setSelected} onDriverSelect={driverId => onFilter({ driverId, vehicleId: "" })} />}
      <aside className="live-route-progress" aria-label="Avance de los choferes">
        {stop && <div className="live-selected-stop"><strong>{stop.position} · {stop.customer}</strong><p>{stop.address}</p><button className="quiet" onClick={() => setSelected("")}>Cerrar detalle</button></div>}
        {routes.map(route => <RouteProgress key={route.id} route={route} now={feed.now} selected={selected} onSelect={setSelected} />)}
      </aside></div>}
  </section>;
}
export function LiveRoutesPage({ revision }: { revision: number }) {
  const feed = useLiveRoutes(revision);
  const [filter,setFilter] = useState({ driverId: "", vehicleId: "" });
  return <div className="standalone-live"><LiveRouteView feed={feed} filter={filter} onFilter={setFilter} /></div>;
}
