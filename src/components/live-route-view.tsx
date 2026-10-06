"use client";
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import { LocateFixed, MapPin, Navigation, Truck, CheckCircle2, AlertTriangle, List, X, Clock } from "lucide-react";
import type { LiveRoute, LiveStop } from "@/core/live-routes";
import type { ControlScreen } from "@/core/live-tracking-policy";
import type { MapConfig } from "@/core/map-config";
import { liveMapFrameKey, locationHealth, routesForDriver } from "@/core/live-route-presentation";
import { api } from "./api";
import { loadGoogleMaps } from "./google-maps";
import { createLiveMapMarkerNode } from "./live-map-marker";
import { useLiveRoutes } from "./use-live-routes";
import { routeEta } from "@/core/live-eta";
import { routeDestinationLabel, warehouseReturnStatus } from "@/core/live-route-destination";
import { activeSegmentStop, segmentMinutes, toggleSegmentStop, type SegmentSelection } from "@/core/live-segment-policy";
import { useLiveSegment } from "./use-live-segment";
import { LiveSegmentReadout } from "./live-segment-readout";

const statusNames = { open: "Abierto", closed_pending: "Cliente cerrado · reintento", rejected: "Rechazado", rescheduled: "Reprogramado", delivered: "Entregado" };
const colors = ["#8dddac", "#c591ee", "#80bffd", "#f5d676", "#f497bc", "#88ded8"];
function RouteProgress({ route, now, selected, onSelect, segment, onClock, segmentReadout }: { route: LiveRoute; now: number; selected: string; onSelect: (id: string) => void;
  segment: SegmentSelection | null; onClock: (id: string) => void; segmentReadout: ReactNode }) {
  const health = locationHealth(route, now);
  return <article className="live-route-card">
    <header><div><h3><Truck size={17} />{route.driver}</h3><p>{route.vehicle} · {route.plate}</p></div><span className={`badge ${route.completedAt || health.live ? "green" : "amber"}`}>{health.label}</span></header>
    <div className="small">{route.label} · {route.date}</div>
    <div className="live-progress-counts"><div><strong>{route.progress.delivered}/{route.progress.orders}</strong><span>pedidos entregados</span></div>
      <div><strong>{route.progress.remainingStops}</strong><span>paradas por atender</span></div></div>
    <progress aria-label={`Entregas de ${route.driver}`} value={route.progress.delivered} max={Math.max(1, route.progress.orders)} />
    <p className="live-route-destination"><Navigation size={16} />{routeDestinationLabel(route, now)}</p>
    <p className="live-eta" aria-label={`Tiempo de ${route.driver}`}>{routeEta(route, now)}</p>
    {segmentReadout}
    <p className="small">{route.progress.completedStops}/{route.progress.totalStops} paradas entregadas · {route.progress.rescheduled} pedidos reprogramados · {route.progress.incidentOrders} con incidencia</p>
    {route.location && <p className="small">Precisión ±{Math.round(route.location.accuracy)} m · {new Date(route.location.observedAt).toLocaleTimeString("es-MX")}</p>}
    {!route.location && !route.completedAt && <p className="live-gps-help">Aún no se ha recibido GPS de esta ruta. En el teléfono, abre la ruta con la APK 0.7.0 o posterior, permite ubicación precisa y revisa el estado de seguimiento. Si está detenido, pulsa «Reanudar seguimiento».</p>}
    {route.corrected && <p className="small">Puntos corregidos. El recorrido anterior se omite.</p>}
    <p className="small">Marca dos relojes para estimar un tramo con sus descargas. Si marcas la parada activa, se calcula desde ahora.</p>
    <div className="live-stop-list">{route.stops.map(stop => <div className="live-stop-row" key={stop.id}><button className={`live-stop ${selected === stop.id ? "selected" : ""} ${stop.progress.status}`} onClick={() => onSelect(stop.id)}>
      <span className="live-stop-number">{stop.progress.status === "delivered" ? <CheckCircle2 size={15} /> : stop.progress.status === "incident" ? <AlertTriangle size={15} /> : stop.position}</span>
      <span><strong>{stop.position} · {stop.customer}</strong><small>{stop.orders.map(o => `${o.name} · ${statusNames[o.status]}`).join(" / ")}</small></span>
    </button><button className="quiet live-stop-clock" aria-label={`Seleccionar parada ${stop.position} para estimar tiempo`}
      title={`Tiempo por ${stop.position} · ${stop.customer}`} disabled={!!route.completedAt || !stop.orders.some(o => o.status === "open")}
      aria-pressed={segment?.executionId === route.id && [segment.fromCurrent ? activeSegmentStop(route) : segment.fromStopId,segment.toStopId].includes(stop.id)}
      onClick={() => onClock(stop.id)}><Clock size={17} /></button></div>)}</div>
  </article>;
}

function LiveMap({ routes, now, filterKey, selected, onSelect, onDriverSelect, summary }: { routes: LiveRoute[]; now: number; filterKey: string; selected: string; onSelect: (id: string) => void; onDriverSelect: (id: string) => void; summary: ReactNode }) {
  const canvas = useRef<HTMLDivElement>(null);
  const truckIcon = useRef<SVGSVGElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [fit, setFit] = useState(0);
  const [follow, setFollow] = useState(false);
  const markers = useRef(new Map<string, { marker: google.maps.marker.AdvancedMarkerElement; node: HTMLButtonElement; label: HTMLSpanElement }>());
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
        setMap(new google.maps.Map(root, { mapId: config.mapId, mapTypeControl: true,
          mapTypeControlOptions: { style: google.maps.MapTypeControlStyle.DROPDOWN_MENU }, controlSize: 26,
          streetViewControl: false, fullscreenControl: false, gestureHandling: "cooperative" })); setError("");
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
        const { node, label } = createLiveMapMarkerNode(driverId ? truckIcon.current : null);
        if (stopId) node.addEventListener("click", () => pick(stopId));
        if (driverId) node.addEventListener("click", () => pickDriver(driverId));
        const marker = new google.maps.marker.AdvancedMarkerElement({ map, position, content: node, title });
        item = { marker, node, label }; markers.current.set(id, item);
      }
      item.marker.position = position; item.marker.title = title;
      item.marker.zIndex = className.includes("driver") ? 100 : 10;
      item.label.textContent = text; item.node.className = className; item.node.style.setProperty("--route-color", color); item.node.setAttribute("aria-label", title);
    }
    routes.forEach((route, index) => {
      const color = colors[index % colors.length];
      for (const stop of route.stops) if (stop.progress.visible && stop.latitude !== null && stop.longitude !== null) {
        marker(stop.id, stop.latitude, stop.longitude, `${stop.position}${stop.progress.pending ? " !" : ""}`, `${route.driver} · ${stop.customer}`,
          `live-map-stop ${stop.progress.status} ${stop.id === selected || stop.id === route.targetStopId ? "active" : ""}`, color, stop.id);
      }
      if (route.location) marker(`driver:${route.id}`, route.location.latitude, route.location.longitude, route.driver, route.driver,
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
    const fitKey = liveMapFrameKey(routes, filterKey, fit);
    // A finished route may have no visible pins and an older APK may supply no GPS.
    // Frame its known addresses without bringing terminal markers back onto the map.
    if (bounds.isEmpty()) for (const route of routes) for (const stop of route.stops) {
      if (stop.latitude !== null && stop.longitude !== null) bounds.extend({ lat: stop.latitude, lng: stop.longitude });
    }
    if (fitted.current !== fitKey && !bounds.isEmpty()) { map.fitBounds(bounds, 56); fitted.current = fitKey; }
    if (follow && !selected && routes.length === 1 && routes[0].location) map.panTo({ lat: routes[0].location.latitude, lng: routes[0].location.longitude });
  }, [map, routes, now, filterKey, fit, follow, selected]);
  useEffect(() => {
    const marker = markers.current.get(selected)?.marker;
    if (map && marker?.position) { map.panTo(marker.position as google.maps.LatLngLiteral); if ((map.getZoom() ?? 0) < 14) map.setZoom(14); }
  }, [selected, map]);
  useEffect(() => {
    if (!map || !canvas.current) return;
    const observer = new ResizeObserver(() => { google.maps.event.trigger(map, "resize"); setFit(n => n+1); }); observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [map]);
  return <div className="live-map-wrap"><div className="live-map-viewport"><div ref={canvas} className="live-map-canvas" aria-label="Mapa de ubicación de choferes" />
    <Truck ref={truckIcon} className="live-driver-icon-template" size={22} aria-hidden="true" />
    <div className="live-map-tools"><button className="quiet" aria-label="Ver todos los puntos" title="Ver todos los puntos" onClick={() => { setFollow(false); setFit(n => n+1); }} disabled={!map || !routes.length}><LocateFixed size={16} /><span>Centrar</span></button>
      <button className="quiet" aria-label="Seguir chofer" title={routes.length !== 1 ? "Selecciona un chofer para seguirlo" : !routes[0]?.location ? "No se ha recibido ubicación del chofer" : "Seguir la última ubicación del chofer"}
        aria-pressed={follow && !selected} disabled={!map || routes.length !== 1 || !routes[0]?.location}
        onClick={() => { onSelect(""); setFollow(v => !v || !!selected); }}><Navigation size={16} /><span>Seguir</span></button></div>
    {!map && <div className="live-map-fallback">{error || "Conectando mapa…"}{error && <button className="quiet" onClick={() => setRetry(n => n+1)}>Reintentar mapa</button>}</div>}
    </div>
    <div className="live-map-summary-footer">{summary}</div>
  </div>;
}

export function LiveRouteView({ feed, filter, onFilter, progressOnly = false }: { feed: ReturnType<typeof useLiveRoutes>; filter: Pick<ControlScreen, "driverId" | "vehicleId">;
  onFilter: (value: Pick<ControlScreen, "driverId" | "vehicleId">) => void; progressOnly?: boolean }) {
  const [selected, setSelected] = useState("");
  const [segment,setSegment] = useState<SegmentSelection | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [timesOpen, setTimesOpen] = useState(false);
  const timesId = useId();
  const timesButton = useRef<HTMLButtonElement>(null);
  const timesClose = useRef<HTMLButtonElement>(null);
  function closeTimes() { setTimesOpen(false); timesButton.current?.focus(); }
  function chooseDriver(driverId: string) {
    setSelected(""); setSegment(null); setTimesOpen(false); onFilter({ driverId, vehicleId: "" });
  }
  useEffect(() => { if (timesOpen) timesClose.current?.focus(); }, [timesOpen]);
  const detailsId = useId();
  const detailsButton = useRef<HTMLButtonElement>(null);
  const detailsClose = useRef<HTMLButtonElement>(null);
  function closeDetails() { setDetailsOpen(false); detailsButton.current?.focus(); }
  function selectStop(id: string) { setSelected(id); if (id) setDetailsOpen(true); }
  useEffect(() => { if (detailsOpen) detailsClose.current?.focus(); }, [detailsOpen]);
  const all = feed.report?.routes ?? [];
  const routes = routesForDriver(all, filter.driverId);
  const segmentRoute = routes.find(r => r.id === segment?.executionId);
  const segmentQuery = useLiveSegment(segmentRoute,segment,feed.now);
  const drivers = [...new Map(all.map(r => [r.driverId, r.driver])).entries()];
  const stop: LiveStop | undefined = routes.flatMap(r => r.stops).find(s => s.id === selected);
  const summary = <div className="live-route-summary" aria-label="Resumen de avance">
    <span title="Pedidos entregados"><strong>{routes.reduce((n,r) => n+r.progress.delivered,0)}/{routes.reduce((n,r) => n+r.progress.orders,0)}</strong> entregados</span>
    <span title="Paradas pendientes"><strong>{routes.reduce((n,r) => n+r.progress.remainingStops,0)}</strong> pendientes</span>
    {routes.length === 1 && <span className={locationHealth(routes[0], feed.now).live ? "gps-live" : "gps-stale"}>{locationHealth(routes[0], feed.now).label}</span>}
    {filter.driverId && routes.length === 1
      ? <span className="live-eta" title="Tiempo estimado al destino activo del chofer">{warehouseReturnStatus(routes[0], feed.now) ? `${routeDestinationLabel(routes[0], feed.now)} · ` : "Próximo destino: "}{routeEta(routes[0], feed.now)}</span>
      : <button ref={timesButton} className="quiet live-times-toggle" aria-expanded={timesOpen} aria-controls={timesId}
          disabled={!routes.length} onClick={() => { setDetailsOpen(false); setTimesOpen(v => !v); }}>Tiempos por chofer</button>}
    {segmentRoute && segment && <span className="live-segment-summary" aria-label="Resumen de tiempo entre paradas">
      <Clock size={12} />{!filter.driverId && `${segmentRoute.driver} · `}{segmentQuery.result
        ? `${segmentQuery.result.fromCurrent ? "Desde ahora" : "Al salir"} · ${segmentQuery.result.fromPosition} → ${segmentQuery.result.toPosition}: ${segmentMinutes(segmentQuery.result.totalSeconds)}${segmentQuery.result.unknownServiceStops ? " · Falta descarga por configurar" : ""}`
        : segmentQuery.error ? "Estimado no disponible" : segmentQuery.loading ? "Calculando tramo…" : "Elige destino con otro reloj"}</span>}
  </div>;
  return <section className={`live-route-view ${progressOnly ? "progress-view" : "map-first"}`} onKeyDown={event => {
    if (event.key === "Escape" && timesOpen) { event.stopPropagation(); closeTimes(); }
    if (event.key === "Escape" && detailsOpen && !progressOnly) { event.stopPropagation(); closeDetails(); }
  }}>
    <div className="live-route-filters"><label>Chofer<select aria-label="Chofer" value={filter.driverId} onChange={e => chooseDriver(e.target.value)}>
      <option value="">Todos los choferes</option>{filter.driverId && !drivers.some(([id]) => id === filter.driverId) && <option value={filter.driverId}>Chofer sin ruta activa</option>}
      {drivers.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      {!progressOnly && <button ref={detailsButton} className="quiet live-details-toggle" aria-expanded={detailsOpen} aria-controls={detailsId} disabled={!routes.length} onClick={() => { setTimesOpen(false); setDetailsOpen(v => !v); }}><List size={16} />Ver avance</button>}
    </div>
    {!!routes.length && progressOnly && summary}
    {feed.error && <p className="notice error" role="alert">{feed.error} Se conserva el último corte. <button className="quiet" onClick={feed.refresh}>Reintentar</button></p>}
    {feed.report && !routes.length && <div className="live-empty"><MapPin size={30} /><h3>Sin rutas iniciadas para este filtro</h3><p>Aparecerán al iniciar una ruta. La ubicación requiere la APK con seguimiento habilitado.</p></div>}
    {!feed.report && !feed.error && <p role="status">Consultando rutas…</p>}
    {!!routes.length && <div className={`live-route-content ${progressOnly ? "progress-only" : ""}`}>
      {!progressOnly && <LiveMap routes={routes} now={feed.now} filterKey={filter.driverId} selected={selected} summary={summary} onSelect={selectStop} onDriverSelect={chooseDriver} />}
      <aside id={timesId} hidden={!timesOpen} className="live-times-panel" aria-label="Tiempos por chofer">
        <div className="live-details-heading"><strong>Tiempos por chofer</strong><button ref={timesClose} className="quiet" aria-label="Cerrar tiempos" onClick={closeTimes}><X size={17} /></button></div>
        {routes.map(route => {
          const target = route.stops.find(stop => stop.id === (route.targetStopId ?? route.arrivedStopId));
          const auxiliary = warehouseReturnStatus(route, feed.now);
          return <button key={route.id} className="live-times-row" onClick={event => {
            const section = event.currentTarget.closest("section");
            chooseDriver(route.driverId);
            section?.querySelector<HTMLSelectElement>('select[aria-label="Chofer"]')?.focus();
          }}><span><strong>{route.driver}</strong><small>{auxiliary || route.completedAt ? routeDestinationLabel(route, feed.now) : target ? `${target.position} · ${target.customer}` : "Sin destino activo"}</small>
            <small>{route.vehicle} · {route.label}</small></span><span className="live-eta">{routeEta(route, feed.now)}</span></button>;
        })}
      </aside>
      <aside id={detailsId} hidden={!progressOnly && !detailsOpen} className="live-route-progress" aria-label="Avance de los choferes">
        {!progressOnly && <div className="live-details-heading"><strong>Avance y paradas</strong><button ref={detailsClose} className="quiet" aria-label="Cerrar avance" onClick={closeDetails}><X size={17} /></button></div>}
        {stop && <div className="live-selected-stop"><strong>{stop.position} · {stop.customer}</strong><p>{stop.address}</p><button className="quiet" onClick={() => setSelected("")}>Cerrar detalle</button></div>}
        {routes.map(route => <RouteProgress key={route.id} route={route} now={feed.now} selected={selected} onSelect={selectStop}
          segment={segment} onClock={id => setSegment(previous => toggleSegmentStop(route,previous,id))}
          segmentReadout={segment?.executionId === route.id ? <LiveSegmentReadout query={segmentQuery} onClear={() => setSegment(null)} /> : null} />)}
      </aside></div>}
  </section>;
}
export function LiveRoutesPage({ revision }: { revision: number }) {
  const feed = useLiveRoutes(revision);
  const [filter,setFilter] = useState({ driverId: "", vehicleId: "" });
  return <div className="standalone-live"><LiveRouteView feed={feed} filter={filter} onFilter={setFilter} /></div>;
}
