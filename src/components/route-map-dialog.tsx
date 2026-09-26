"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X, MapPin, RefreshCw } from "lucide-react";
import type { OrderBoard, Shipment } from "@/core/orders-contract";
import type { MapConfig } from "@/core/map-config";
import type {
  PublicOptimization,
  RoutingSettings,
} from "@/core/routing-contract";
import { groupRouteMapStops, nextOpenMarker } from "@/core/route-map-markers";
import { selectRouteMapView } from "@/core/route-map-selection";
import {
  manualPreviewDecision,
  type ManualPreviewStatus,
} from "@/core/manual-route-preview";
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
  const [previewRequestError, setPreviewRequestError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [manualStatus, setManualStatus] = useState<ManualPreviewStatus | null>(
    null,
  );
  const attemptedVersions = useRef(new Set<number>());
  const vehicles = [
    { id: "unassigned", name: "Sin asignar" },
    ...board.vehicles,
  ];
  const { shipments: visible, routes: selectedRoutes } = useMemo(
    () => selectRouteMapView(board, optimization, filter),
    [board, optimization, filter],
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
        const [nextBoard, nextRun, nextOrigin, nextStatus] = await Promise.all([
          api<OrderBoard>(`/api/plans/${initialBoard.plan.id}/orders`),
          api<PublicOptimization | null>(
            `/api/plans/${initialBoard.plan.id}/optimization`,
          ),
          api<RoutingSettings>("/api/routing/settings"),
          api<ManualPreviewStatus>(
            `/api/plans/${initialBoard.plan.id}/recalculation/manual`,
          ),
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
        setManualStatus((previous) =>
          JSON.stringify(previous) === JSON.stringify(nextStatus)
            ? previous
            : nextStatus,
        );
        if (
          nextStatus.current ||
          nextStatus.status === "pending" ||
          nextStatus.status === "running"
        )
          setPreviewRequestError("");
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
    if (!origin || !manualStatus) return;
    if (manualPreviewDecision(board, origin, manualStatus) !== "request")
      return;
    const version = board.plan.version;
    if (attemptedVersions.current.has(version)) return;
    attemptedVersions.current.add(version);
    let active = true;
    void api(`/api/plans/${board.plan.id}/recalculation/manual`, "POST", {
      expectedVersion: version,
    })
      .then(() => {
        if (active)
          setManualStatus({
            version,
            current: false,
            status: "pending",
            errorCode: null,
          });
      })
      .catch((caught) => {
        if (active) setPreviewRequestError((caught as Error).message);
      });
    return () => {
      active = false;
    };
  }, [board, origin, manualStatus]);
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
    let openMarkerKey: string | null = null;
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
    const markerGroups = groupRouteMapStops(
      visible.flatMap((shipment) => {
        const position = locations[shipment.id]?.position;
        return position
          ? [{ shipment, position, stopNumber: stopNumber(shipment) }]
          : [];
      }),
    );
    for (const group of markerGroups) {
      const orders = group.stops.map((stop) => stop.shipment);
      const position = group.position;
      bounds.extend(position);
      const pin = document.createElement("div");
      pin.className = "map-pin";
      const lanes = [...new Set(orders.map((order) => laneIndex(order)))];
      pin.style.background =
        lanes.length === 1
          ? color(lanes[0])
          : `linear-gradient(90deg, ${lanes
              .map(
                (lane, index) =>
                  `${color(lane)} ${Math.round((index * 100) / lanes.length)}% ${Math.round(((index + 1) * 100) / lanes.length)}%`,
              )
              .join(", ")})`;
      pin.textContent = group.label;
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: currentMap,
        position,
        content: pin,
        title: orders
          .map(
            (s) =>
              `${vehicles[laneIndex(s)].name}: ${s.customerName} · ${s.orderName}`,
          )
          .join(" / "),
      });
      marker.addListener("click", () => {
        const next = nextOpenMarker(openMarkerKey, group.key);
        if (next === null) {
          info.close();
          openMarkerKey = null;
          return;
        }
        const content = document.createElement("div");
        content.style.color = "#17221b";
        for (const s of orders) {
          const p = document.createElement("p");
          p.textContent = `${s.customerName} · ${s.orderName} · ${vehicles[laneIndex(s)].name} · Parada ${stopNumber(s)}${s.priority === "high" ? " · Prioridad alta" : s.priority === "medium" ? " · Prioridad media" : ""}${s.deliveryWindows.length ? ` · ${s.deliveryWindows.map((window) => `${String(Math.floor(window.startMinute / 60)).padStart(2, "0")}:${String(window.startMinute % 60).padStart(2, "0")}–${String(Math.floor(window.endMinute / 60)).padStart(2, "0")}:${String(window.endMinute % 60).padStart(2, "0")}`).join(" / ")}` : ""}`;
          content.append(p);
        }
        info.setContent(content);
        openMarkerKey = next;
        info.open({ map: currentMap, anchor: marker });
      });
      markers.push(marker);
    }
    const closeInfo = info.addListener("closeclick", () => {
      openMarkerKey = null;
    });
    for (const optimizedRoute of selectedRoutes) {
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
    if (!bounds.isEmpty()) currentMap.fitBounds(bounds, 60);
    const idle = google.maps.event.addListenerOnce(currentMap, "idle", () => {
      if ((currentMap.getZoom() ?? 0) > 17) currentMap.setZoom(17);
    });
    return () => {
      idle.remove();
      closeInfo.remove();
      info.close();
      markers.forEach((marker) => {
        google.maps.event.clearInstanceListeners(marker);
        marker.map = null;
      });
      routeLines.forEach((line) => line.setMap(null));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, filter, board, selectedRoutes, origin]);

  const optimizedStops = new globalThis.Map(
    selectedRoutes.flatMap((route) =>
      route.stops.map((stop) => [stop.shipmentId, stop] as const),
    ),
  );
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
  const previewDecision =
    origin && manualStatus
      ? manualPreviewDecision(board, origin, manualStatus)
      : null;
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
    setPreviewRequestError("");
    try {
      await api(`/api/plans/${board.plan.id}/recalculation/manual`, "POST", {
        expectedVersion: board.plan.version,
      });
      setManualStatus({
        version: board.plan.version,
        current: false,
        status: "pending",
        errorCode: null,
      });
    } catch (caught) {
      setPreviewRequestError((caught as Error).message);
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
        {visible.length === 0 ? (
          <span className="small" role="status">
            {filter === "unassigned"
              ? "No hay pedidos sin asignar."
              : "Sin pedidos asignados en esta vista."}
          </span>
        ) : filter === "unassigned" ? (
          <span className="small">
            Pedidos sin ruta asignada; no forman un recorrido.
          </span>
        ) : selectedRoutes.length > 0 ? (
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
            {manualStatus?.status === "pending" ||
            manualStatus?.status === "running" ||
            optimization.recalculation?.status === "pending" ||
            optimization.recalculation?.status === "running"
              ? "Recalculando recorrido; se conserva tu acomodo…"
              : "Tu acomodo está guardado. El recorrido necesita recalcularse."}
            {(previewRequestError ||
              manualStatus?.status === "failed" ||
              (!manualStatus?.status &&
                (!optimization.recalculation ||
                  optimization.recalculation.status === "failed"))) && (
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
            {manualStatus?.status === "pending" ||
            manualStatus?.status === "running"
              ? "Calculando recorrido vial; conservamos tu orden manual…"
              : manualStatus?.status === "failed" || previewRequestError
                ? "No se pudo calcular el recorrido. Reintenta cuando haya conexión."
                : previewDecision === "incomplete"
                  ? "Para trazar calles faltan bodega, hora de salida o puntos confirmados."
                  : "Puntos y orden manual; ruta aún no calculada."}
            {(manualStatus?.status === "failed" || previewRequestError) && (
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
        )}
      </div>
      {(refreshError ||
        previewRequestError ||
        manualStatus?.errorCode ||
        optimization?.recalculation?.errorCode) && (
        <p className="notice error" role="alert">
          {refreshError ||
            previewRequestError ||
            errors[
              manualStatus?.errorCode ||
                optimization?.recalculation?.errorCode ||
                ""
            ] ||
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
            {visible.length === 0 && (
              <p>
                {filter === "unassigned"
                  ? "Todos los pedidos están asignados."
                  : "Asigna pedidos a una camioneta para ver sus paradas. Los pedidos retirados siguen disponibles en Sin asignar."}
              </p>
            )}
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
