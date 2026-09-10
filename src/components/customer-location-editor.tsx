"use client";
import { useRef, useState } from "react";
import { Check, LocateFixed, MapPin } from "lucide-react";
import type { MapConfig } from "@/core/map-config";
import { api } from "./api";
import { loadGoogleMaps } from "./google-maps";

export type EditableLocation = {
  latitude: number;
  longitude: number;
  placeId: string | null;
};

export function CustomerLocationEditor({
  address,
  location,
  mapUrl,
  onLocation,
  onMapUrl,
  legend = "Punto y liga de Maps",
  showMapUrl = true,
}: {
  address: string;
  location: EditableLocation | null;
  mapUrl: string;
  onLocation: (location: EditableLocation | null) => void;
  onMapUrl: (url: string) => void;
  legend?: string;
  showMapUrl?: boolean;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [proposed, setProposed] = useState<EditableLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function locate() {
    setBusy(true);
    setError("");
    try {
      const config = await api<MapConfig>("/api/maps/config");
      if (!config.configured)
        throw new Error(
          "Google Maps aún no está configurado. Puedes guardar el domicilio y dejar el punto pendiente.",
        );
      await loadGoogleMaps(config.browserKey);
      const { Map } = (await google.maps.importLibrary(
        "maps",
      )) as google.maps.MapsLibrary;
      const { Geocoder } = (await google.maps.importLibrary(
        "geocoding",
      )) as google.maps.GeocodingLibrary;
      const { AdvancedMarkerElement } = (await google.maps.importLibrary(
        "marker",
      )) as google.maps.MarkerLibrary;
      const response = await new Geocoder().geocode({ address });
      const found = response.results[0];
      if (!found) throw new Error("Google no encontró ese domicilio.");
      if (found.partial_match)
        setError(
          "La coincidencia es parcial. Revisa y mueve el punto antes de confirmarlo.",
        );
      const initial = {
        ...found.geometry.location.toJSON(),
        placeId: found.place_id || null,
      };
      const value = {
        latitude: initial.lat,
        longitude: initial.lng,
        placeId: initial.placeId,
      };
      setProposed(value);
      if (!canvas.current) return;
      const map = new Map(canvas.current, {
        center: initial,
        zoom: 17,
        mapId: config.mapId,
        streetViewControl: false,
        mapTypeControl: false,
      });
      const marker = new AdvancedMarkerElement({
        map,
        position: initial,
        gmpDraggable: true,
        title: "Punto de entrega propuesto",
      });
      marker.addListener("dragend", () => {
        const position = marker.position;
        const lat =
          typeof position?.lat === "number" ? position.lat : position?.lat();
        const lng =
          typeof position?.lng === "number" ? position.lng : position?.lng();
        if (typeof lat === "number" && typeof lng === "number")
          setProposed({ latitude: lat, longitude: lng, placeId: null });
      });
      map.addListener("click", (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return;
        const point = event.latLng.toJSON();
        marker.position = point;
        setProposed({
          latitude: point.lat,
          longitude: point.lng,
          placeId: null,
        });
      });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="customer-location">
      <legend>{legend}</legend>
      <div className="customer-location-status">
        <MapPin size={16} />
        <span>
          {location
            ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
            : "Punto por confirmar"}
        </span>
        <button
          type="button"
          className="quiet"
          disabled={busy || !address}
          onClick={() => void locate()}
        >
          <LocateFixed size={15} />
          {busy ? "Buscando…" : "Ubicar domicilio"}
        </button>
      </div>
      {showMapUrl && (
        <label>
          Liga de Maps
          <input
            type="url"
            maxLength={1000}
            placeholder="https://maps.google.com/…"
            value={mapUrl}
            onChange={(event) => {
              onMapUrl(event.target.value);
              if (location) onLocation(null);
            }}
          />
        </label>
      )}
      <div
        className={`customer-map-preview ${proposed ? "visible" : ""}`}
        ref={canvas}
      />
      {proposed && (
        <button
          type="button"
          className="primary"
          onClick={() => {
            onLocation(proposed);
            onMapUrl(
              `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${proposed.latitude},${proposed.longitude}`)}`,
            );
            setProposed(null);
            setError("");
          }}
        >
          <Check size={15} /> Confirmar este punto
        </button>
      )}
      {error && <p className="field-warning">{error}</p>}
    </fieldset>
  );
}
