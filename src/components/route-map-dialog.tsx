"use client";
import { useEffect, useId, useRef, useState } from "react";
import { X, MapPin, RefreshCw } from "lucide-react";
import type { OrderBoard, Shipment } from "@/core/orders-contract";
import type { MapConfig } from "@/core/map-config";
import type {
  PublicOptimization,
  RoutingSettings,
} from "@/core/routing-contract";
import { api, errors } from "./api";
import { loadGoogleMaps } from "./google-maps";

type Located = { position?: google.maps.LatLngLiteral; issue?: string };
function color(index: number) {
  return `hsl(${(index * 137.508 + 145) % 360} 70% 64%)`;
}

export function RouteMapDialog({
  board: initialBoard,
  timezone,
  onClose,
}: {
  board: OrderBoard;
  timezone: string;
  onClose: () => void;
}) {
  const [board, setBoard] = useState(initialBoard);
  const dialog = useRef<HTMLDialogElement>(null),
    canvas = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const title = useId();
  const [config, setConfig] = useState<MapConfig | null>(null);
  const [optimization, setOptimization] = useState<PublicOptimization | null>(
    null,
  );
  const [origin, setOrigin] = useState<RoutingSettings | null>(null);
  const [locations, setLocations] = useState<Record<string, Located>>({});
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(true);
  const [filter, setFilter] = useState("all");
  const [revision, setRevision] = useState(0);
  const [refreshError, setRefreshError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const vehicles = [
    { id: "unassigned", name: "Sin asignar" },
    ...board.vehicles,
  ];
  const visible = board.shipments.filter(
    (s) => filter === "all" || (s.vehicle_id || "unassigned") === filter,
  );
  const laneIndex = (s: Shipment) =>
    vehicles.findIndex((v) => v.id === (s.vehicle_id || "unassigned"));
  const stopNumber = (s: Shipment) =>
    board.shipments
      .filter((p) => p.vehicle_id === s.vehicle_id)
      .findIndex((p) => p.id === s.id) + 1;
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [nextBoard, nextRun, nextOrigin] = await Promise.all([
          api<OrderBoard>(`/api/plans/${initialBoard.plan.id}/orders`),
          api<PublicOptimization | null>(
            `/api/plans/${initialBoard.plan.id}/optimization`,
          ),
          api<RoutingSettings>("/api/routing/settings"),
        ]);
        if (!active) return;
        setBoard((previous) =>
          JSON.stringify(previous) === JSON.stringify(nextBoard)
            ? previous
            : nextBoard,
        );
        setOptimization((previous) =>
          JSON.stringify(previous) === JSON.stringify(nextRun)
            ? previous
            : nextRun,
        );
        setOrigin((previous) =>
          JSON.stringify(previous) === JSON.stringify(nextOrigin)
            ? previous
            : nextOrigin,
        );
        setRefreshError("");
      } catch (caught) {
        if (active) setRefreshError((caught as Error).message);
      } finally {
        if (active) timer = setTimeout(() => void refresh(), 2000);
      }
    }
    timer = setTimeout(() => void refresh(), 2000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [initialBoard.plan.id]);
  useEffect(() => {
    const element = dialog.current,
      previous = document.activeElement as HTMLElement;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    let current = true;
    async function initialize() {
      const [settings, optimized, routing] = await Promise.all([
        api<MapConfig>("/api/maps/config"),
        api<PublicOptimization | null>(
          `/api/plans/${board.plan.id}/optimization`,
        ),
        api<RoutingSettings>("/api/routing/settings"),
      ]);
      if (!current) return;
      setConfig(settings);
      setOptimization(optimized);
      setOrigin(routing);
      if (!settings.configured) return;
      await loadGoogleMaps(settings.browserKey);
      const { Map } = (await google.maps.importLibrary(
        "maps",
      )) as google.maps.MapsLibrary;
      const { Geocoder } = (await google.maps.importLibrary(
        "geocoding",
      )) as google.maps.GeocodingLibrary;
      await google.maps.importLibrary("marker");
      await google.maps.importLibrary("geometry");
      if (!current || !canvas.current) return;
      // fitBounds sets the real center once at least one delivery is located.
      map.current = new Map(canvas.current, {
        mapId: settings.mapId,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: false,
      });
      const geocoder = new Geocoder();
      const geocoded = new globalThis.Map<string, Located>();
      for (const shipment of board.shipments) {
        if (!current) return;
        let result: Located;
        if (shipment.latitude !== null && shipment.longitude !== null)
          result = {
            position: {
              lat: shipment.latitude,
              lng: shipment.longitude,
            },
          };
        else if (geocoded.has(shipment.address))
          result = geocoded.get(shipment.address)!;
        else if (!shipment.address.trim())
          result = { issue: "Dirección pendiente" };
        else {
          try {
            const response = await geocoder.geocode({
              address: shipment.address,
            });
            if (!current) return;
            const found = response.results;
            result =
              found.length !== 1 ||
              found[0].partial_match ||
              !found[0].types.some((type) =>
                ["street_address", "premise", "subpremise"].includes(type),
              )
                ? { issue: "Ubicación ambigua: revisar dirección" }
                : { position: found[0].geometry.location.toJSON() };
          } catch (e) {
            const code = (e as { code?: string }).code;
            if (code !== "ZERO_RESULTS")
              throw new Error(
                "Google no pudo completar la ubicación de los pedidos. Puedes reintentar; el plan se conserva.",
              );
            result = { issue: "Dirección no encontrada" };
          }
        }
        geocoded.set(shipment.address, result);
        if (current)
          setLocations((previous) => ({
            ...previous,
            [shipment.id]: result,
          }));
      }
    }
    void initialize()
      .catch((e) => {
        if (current) setError((e as Error).message);
      })
      .finally(() => {
        if (current) setLocating(false);
      });
    return () => {
      current = false;
      map.current = null;
    };
  }, [board.plan.id, board.shipments, revision]);
  useEffect(() => {
    if (!map.current || typeof google === "undefined") return;
    const currentMap = map.current;
    const bounds = new google.maps.LatLngBounds();
    const markers: google.maps.marker.AdvancedMarkerElement[] = [];
    const routeLines: google.maps.Polyline[] = [];
    const info = new google.maps.InfoWindow();
    // Keep colocated orders as separate records; one pin exposes all at that exact point.
    const groups = new globalThis.Map<string, Shipment[]>();
    if (origin?.depotLocation) {
      const position = {
        lat: origin.depotLocation.latitude,
        lng: origin.depotLocation.longitude,
      };
      bounds.extend(position);
      const pin = document.createElement("div");
      pin.className = "map-pin map-origin-pin";
      pin.textContent = "Bodega · salida y regreso";
      markers.push(
        new google.maps.marker.AdvancedMarkerElement({
          map: currentMap,
          position,
          content: pin,
          title: `Salida y regreso · ${origin.depotAddress}`,
        }),
      );
    }
    for (const shipment of visible) {
      const position = locations[shipment.id]?.position;
      if (!position) continue;
      const key = JSON.stringify(position);
      groups.set(key, [...(groups.get(key) || []), shipment]);
    }
    for (const orders of groups.values()) {
      const position = locations[orders[0].id].position!;
      bounds.extend(position);
      const pin = document.createElement("div");
      pin.className = "map-pin";
      pin.style.background = color(laneIndex(orders[0]));
      pin.textContent =
        orders.length === 1
          ? String(stopNumber(orders[0]))
          : `${orders.length} pedidos`;
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: currentMap,
        position,
        content: pin,
        title: orders
          .map((s) => `${s.customerName} · ${s.orderName}`)
          .join(" / "),
      });
      marker.addListener("click", () => {
        const content = document.createElement("div");
        content.style.color = "#17221b";
        for (const s of orders) {
          const p = document.createElement("p");
          p.textContent = `${s.customerName} · ${s.orderName} · ${vehicles[laneIndex(s)].name} · Parada ${stopNumber(s)}${s.priority === "high" ? " · Prioridad alta" : s.priority === "medium" ? " · Prioridad media" : ""}${s.deliveryWindows.length ? ` · ${s.deliveryWindows.map((window) => `${String(Math.floor(window.startMinute / 60)).padStart(2, "0")}:${String(window.startMinute % 60).padStart(2, "0")}–${String(Math.floor(window.endMinute / 60)).padStart(2, "0")}:${String(window.endMinute % 60).padStart(2, "0")}`).join(" / ")}` : ""}`;
          content.append(p);
        }
        info.setContent(content);
        info.open({ map: currentMap, anchor: marker });
      });
      markers.push(marker);
    }
    if (optimization?.current) {
      for (const optimizedRoute of optimization.routes) {
        if (filter !== "all" && optimizedRoute.vehicleId !== filter) continue;
        const polylines =
          optimizedRoute.segmentPolylines ??
          (optimizedRoute.encodedPolyline
            ? [optimizedRoute.encodedPolyline]
            : []);
        for (const polyline of polylines) {
          const path = google.maps.geometry.encoding.decodePath(polyline);
          path.forEach((point) => bounds.extend(point));
          const vehicleIndex = vehicles.findIndex(
            (vehicle) => vehicle.id === optimizedRoute.vehicleId,
          );
          routeLines.push(
            new google.maps.Polyline({
              map: currentMap,
              path,
              strokeColor: color(Math.max(1, vehicleIndex)),
              strokeOpacity: 0.9,
              strokeWeight: 5,
            }),
          );
        }
      }
    }
    if (!bounds.isEmpty()) currentMap.fitBounds(bounds, 60);
    const idle = google.maps.event.addListenerOnce(currentMap, "idle", () => {
      if ((currentMap.getZoom() ?? 0) > 17) currentMap.setZoom(17);
    });
    return () => {
      idle.remove();
      info.close();
      markers.forEach((marker) => {
        google.maps.event.clearInstanceListeners(marker);
        marker.map = null;
      });
      routeLines.forEach((line) => line.setMap(null));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, filter, board, optimization, origin]);

  const optimizedStops = new globalThis.Map(
    (optimization?.current ? optimization.routes : []).flatMap((route) =>
      route.stops.map((stop) => [stop.shipmentId, stop] as const),
    ),
  );
  const selectedRoutes = (
    optimization?.current ? optimization.routes : []
  ).filter((route) => filter === "all" || route.vehicleId === filter);
  const minutes = Math.round(
    selectedRoutes.reduce(
      (sum, route) => sum + route.metrics.totalDurationSeconds,
      0,
    ) / 60,
  );
  const distance = selectedRoutes.reduce(
    (sum, route) => sum + route.metrics.travelDistanceMeters,
    0,
  );
  const time = (value: string) =>
    new Date(value).toLocaleTimeString("es-MX", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  async function retryRoute() {
    setRetrying(true);
    setRefreshError("");
    try {
      await api(`/api/plans/${board.plan.id}/recalculation`, "POST");
      setOptimization(
        await api<PublicOptimization | null>(
          `/api/plans/${board.plan.id}/optimization`,
        ),
      );
    } catch (caught) {
      setRefreshError((caught as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <dialog
      className="route-map-dialog"
      ref={dialog}
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="panel-header">
        <h2 id={title}>
          <MapPin size={18} /> Mapa de rutas · {board.plan.label}
        </h2>
        <button className="quiet" aria-label="Cerrar mapa" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="map-toolbar">
        <label>
          Mostrar
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Todas las camionetas</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <span className="small">
          {visible.length} pedidos ·{" "}
          {visible.filter((s) => locations[s.id]?.position).length} ubicados
        </span>
        {optimization?.current ? (
          <span className="small route-metrics">
            Recorrido vigente · regreso incluido ·{" "}
            {(distance / 1000).toLocaleString("es-MX", {
              maximumFractionDigits: 1,
            })}{" "}
            km · {Math.floor(minutes / 60)} h {minutes % 60} min
            {filter === "all" ? " acumulados" : ""}
          </span>
        ) : optimization ? (
          <span className="small warning" role="status">
            {optimization.recalculation?.status === "pending" ||
            optimization.recalculation?.status === "running"
              ? "Recalculando recorrido; se conserva tu acomodo…"
              : "Tu acomodo está guardado. El recorrido necesita recalcularse."}
            {(!optimization.recalculation ||
              optimization.recalculation.status === "failed") && (
              <button
                className="quiet"
                disabled={retrying}
                onClick={() => void retryRoute()}
              >
                <RefreshCw size={14} />
                {retrying ? "Solicitando…" : "Reintentar cálculo"}
              </button>
            )}
          </span>
        ) : (
          <span className="small">
            Puntos y orden manual; ruta aún no calculada.
          </span>
        )}
      </div>
      {(refreshError || optimization?.recalculation?.errorCode) && (
        <p className="notice error" role="alert">
          {refreshError ||
            errors[optimization!.recalculation!.errorCode!] ||
            "El recálculo no pudo completarse; tus cambios siguen guardados."}
        </p>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button
            className="quiet"
            onClick={() => {
              setError("");
              setLocations({});
              setLocating(true);
              setRevision((v) => v + 1);
            }}
          >
            <RefreshCw size={15} />
            Reintentar
          </button>
        </div>
      )}
      {config?.configured === false ? (
        <div className="map-empty">
          <MapPin size={32} />
          <h3>Mapa pendiente de activar</h3>
          <p>
            La conexión con Google Maps aún no está configurada. Tus pedidos y
            asignaciones están guardados.
          </p>
        </div>
      ) : (
        <div className="map-content">
          <div
            className="map-canvas"
            ref={canvas}
            aria-label="Mapa de puntos de entrega"
          />
          <aside className="map-stops" aria-label="Puntos de entrega">
            {locating && <p role="status">Ubicando direcciones…</p>}
            {selectedRoutes
              .filter((route) => route.stops.length > 0)
              .map((route) => (
                <div className="map-stop small" key={route.vehicleId}>
                  <strong>{route.vehicleName}</strong>
                  {route.departureAt && (
                    <small>Salida de bodega: {time(route.departureAt)}</small>
                  )}
                  {route.finishedAt && (
                    <small>Regreso a bodega: {time(route.finishedAt)}</small>
                  )}
                  {route.trafficMode === "static" && (
                    <small>
                      Estimación sin tráfico en vivo para la hora pasada.
                    </small>
                  )}
                  <small>
                    Traslados y esperas; no incluye tiempo de descarga.
                  </small>
                </div>
              ))}
            {visible.map((s) => (
              <button
                className="map-stop quiet"
                key={s.id}
                disabled={!locations[s.id]?.position}
                onClick={() => {
                  map.current?.panTo(locations[s.id].position!);
                  map.current?.setZoom(17);
                }}
              >
                <strong>
                  <span
                    className="map-legend"
                    style={{ background: color(laneIndex(s)) }}
                  />
                  {stopNumber(s)} · {s.customerName}
                </strong>
                <small>
                  {s.orderName} · {vehicles[laneIndex(s)].name}
                </small>
                {optimizedStops.get(s.id) && (
                  <small className="route-stop-metrics">
                    ETA{" "}
                    {new Date(optimizedStops.get(s.id)!.eta).toLocaleTimeString(
                      "es-MX",
                      {
                        timeZone: timezone,
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      },
                    )}{" "}
                    · tramo{" "}
                    {(
                      optimizedStops.get(s.id)!.travelDistanceMeters / 1000
                    ).toLocaleString("es-MX", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    km
                  </small>
                )}
                <small>{s.address || "Dirección pendiente"}</small>
                {!!optimizedStops.get(s.id)?.lateSeconds && (
                  <small className="warning">
                    Fuera de ventana:{" "}
                    {Math.ceil(optimizedStops.get(s.id)!.lateSeconds! / 60)} min
                    después del cierre.
                  </small>
                )}
                {optimizedStops.get(s.id)?.priorityConflict && (
                  <small className="warning">
                    El acomodo manual adelanta este pedido a uno de mayor
                    prioridad.
                  </small>
                )}
                <small>
                  {s.deliveryWindows.length
                    ? s.deliveryWindows
                        .map(
                          (window) =>
                            `${String(Math.floor(window.startMinute / 60)).padStart(2, "0")}:${String(window.startMinute % 60).padStart(2, "0")}–${String(Math.floor(window.endMinute / 60)).padStart(2, "0")}:${String(window.endMinute % 60).padStart(2, "0")}`,
                        )
                        .join(" / ")
                    : "Sin horario registrado"}
                  {s.priority === "high"
                    ? " · Prioridad alta"
                    : s.priority === "medium"
                      ? " · Prioridad media"
                      : ""}
                </small>
                {locations[s.id]?.issue && (
                  <small className="warning">{locations[s.id].issue}</small>
                )}
              </button>
            ))}
          </aside>
        </div>
      )}
    </dialog>
  );
}
