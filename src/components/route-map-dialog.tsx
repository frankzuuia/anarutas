"use client";
import { useEffect, useId, useRef, useState } from "react";
import { X, MapPin, RefreshCw } from "lucide-react";
import type { OrderBoard, Shipment } from "@/core/orders-contract";
import type { MapConfig } from "@/core/map-config";
import { api } from "./api";
import { loadGoogleMaps } from "./google-maps";

type Located = { position?: google.maps.LatLngLiteral; issue?: string };
function color(index: number) {
  return `hsl(${(index * 137.508 + 145) % 360} 70% 64%)`;
}

export function RouteMapDialog({
  board,
  onClose,
}: {
  board: OrderBoard;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    canvas = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const title = useId();
  const [config, setConfig] = useState<MapConfig | null>(null);
  const [locations, setLocations] = useState<Record<string, Located>>({});
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(true);
  const [filter, setFilter] = useState("all");
  const [revision, setRevision] = useState(0);
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
      const settings = await api<MapConfig>("/api/maps/config");
      if (!current) return;
      setConfig(settings);
      if (!settings.configured) return;
      await loadGoogleMaps(settings.browserKey);
      const { Map } = (await google.maps.importLibrary(
        "maps",
      )) as google.maps.MapsLibrary;
      const { Geocoder } = (await google.maps.importLibrary(
        "geocoding",
      )) as google.maps.GeocodingLibrary;
      await google.maps.importLibrary("marker");
      if (!current || !canvas.current) return;
      // fitBounds sets the real center once at least one delivery is located.
      map.current = new Map(canvas.current, {
        mapId: settings.mapId,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: false,
      });
      const geocoder = new Geocoder();
      const addresses = [...new Set(board.shipments.map((s) => s.address))];
      for (const address of addresses) {
        if (!current) return;
        let result: Located;
        if (!address.trim()) result = { issue: "Dirección pendiente" };
        else {
          try {
            const response = await geocoder.geocode({ address });
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
        if (current)
          setLocations((previous) => ({ ...previous, [address]: result }));
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
  }, [board.shipments, revision]);
  useEffect(() => {
    if (!map.current || typeof google === "undefined") return;
    const currentMap = map.current;
    const bounds = new google.maps.LatLngBounds();
    const markers: google.maps.marker.AdvancedMarkerElement[] = [];
    const info = new google.maps.InfoWindow();
    // Keep colocated orders as separate records; one pin exposes all at that exact point.
    const groups = new globalThis.Map<string, Shipment[]>();
    for (const shipment of visible) {
      const position = locations[shipment.address]?.position;
      if (!position) continue;
      const key = JSON.stringify(position);
      groups.set(key, [...(groups.get(key) || []), shipment]);
    }
    for (const orders of groups.values()) {
      const position = locations[orders[0].address].position!;
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
          p.textContent = `${s.customerName} · ${s.orderName} · ${vehicles[laneIndex(s)].name} · Parada ${stopNumber(s)}${s.high_priority ? " · Prioridad alta" : ""}${s.window_start ? ` · ${s.window_start}–${s.window_end}` : ""}`;
          content.append(p);
        }
        info.setContent(content);
        info.open({ map: currentMap, anchor: marker });
      });
      markers.push(marker);
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
    };
    // The board is immutable while this read-only modal is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, filter, board]);

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
          {visible.filter((s) => locations[s.address]?.position).length}{" "}
          ubicados
        </span>
        <span className="small">
          Puntos de entrega y orden actual. Optimización pendiente.
        </span>
      </div>
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
            {visible.map((s) => (
              <button
                className="map-stop quiet"
                key={s.id}
                disabled={!locations[s.address]?.position}
                onClick={() => {
                  map.current?.panTo(locations[s.address].position!);
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
                <small>{s.address || "Dirección pendiente"}</small>
                <small>
                  {s.window_start
                    ? `${s.window_start}–${s.window_end}`
                    : "Sin horario registrado"}
                  {s.high_priority ? " · Prioridad alta" : ""}
                </small>
                {locations[s.address]?.issue && (
                  <small className="warning">
                    {locations[s.address].issue}
                  </small>
                )}
              </button>
            ))}
          </aside>
        </div>
      )}
    </dialog>
  );
}
