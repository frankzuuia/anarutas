"use client";
import { useEffect, useRef, useState } from "react";
import { Check, LocateFixed, MapPin } from "lucide-react";
import type { MapConfig } from "@/core/map-config";
import {
  geocodeQualityIssue,
  type GeocodeQualityIssue,
} from "@/core/geocode-quality";
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
  requirePreciseResult = false,
  geocodeRegion,
  geocodeCountry,
  onResolvedAddress,
}: {
  address: string;
  location: EditableLocation | null;
  mapUrl: string;
  onLocation: (location: EditableLocation | null) => void;
  onMapUrl: (url: string) => void;
  legend?: string;
  showMapUrl?: boolean;
  requirePreciseResult?: boolean;
  geocodeRegion?: string;
  geocodeCountry?: string;
  onResolvedAddress?: (address: string) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const locatedAddress = useRef(address);
  const [proposed, setProposed] = useState<EditableLocation | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resolvedAddress, setResolvedAddress] = useState("");

  const issueMessage: Record<GeocodeQualityIssue, string> = {
    PARTIAL_MATCH: "Google sólo reconoció una parte de la dirección.",
    APPROXIMATE_LOCATION:
      "Google devolvió una zona aproximada, no un domicilio preciso.",
    NOT_A_DELIVERY_ADDRESS:
      "Google devolvió una colonia o calle general, no un domicilio puntual.",
  };

  useEffect(() => {
    if (address === locatedAddress.current) return;
    locatedAddress.current = address;
    setProposed(null);
    setPreviewVisible(false);
    setResolvedAddress("");
    setError("");
  }, [address]);

  async function locate() {
    locatedAddress.current = address;
    setBusy(true);
    setError("");
    setResolvedAddress("");
    setProposed(null);
    setPreviewVisible(false);
    if (requirePreciseResult) {
      onLocation(null);
      onMapUrl("");
    }
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
      const response = await new Geocoder().geocode({
        address,
        ...(geocodeRegion ? { region: geocodeRegion } : {}),
        ...(geocodeCountry
          ? { componentRestrictions: { country: geocodeCountry } }
          : {}),
      });
      const quality = (result: google.maps.GeocoderResult) =>
        geocodeQualityIssue({
          partialMatch: Boolean(result.partial_match),
          locationType: String(result.geometry.location_type),
          types: result.types,
        });
      const found = requirePreciseResult
        ? response.results.find((result) => quality(result) === null) ||
          response.results[0]
        : response.results[0];
      if (!found) throw new Error("Google no encontró ese domicilio.");
      const issue = quality(found);
      if (requirePreciseResult && issue) {
        setError(
          `${issueMessage[issue]} Google encontró “${found.formatted_address}”. Completa el domicilio o marca manualmente la salida exacta en el mapa.`,
        );
      }
      if (found.partial_match)
        setError(
          "La coincidencia es parcial. Revisa y mueve el punto antes de confirmarlo.",
        );
      setResolvedAddress(
        requirePreciseResult && issue
          ? `Referencia aproximada: ${found.formatted_address}`
          : found.formatted_address,
      );
      if (!(requirePreciseResult && issue)) {
        locatedAddress.current = found.formatted_address;
        onResolvedAddress?.(found.formatted_address);
      }
      const initial = {
        ...found.geometry.location.toJSON(),
        placeId: found.place_id || null,
      };
      const value = {
        latitude: initial.lat,
        longitude: initial.lng,
        placeId: initial.placeId,
      };
      setProposed(requirePreciseResult && issue ? null : value);
      setPreviewVisible(true);
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
        setResolvedAddress("Punto ajustado manualmente en el mapa.");
        setError("");
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
        setResolvedAddress("Punto ajustado manualmente en el mapa.");
        setError("");
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
        className={`customer-map-preview ${previewVisible ? "visible" : ""}`}
        ref={canvas}
      />
      {proposed && (
        <>
          {resolvedAddress && (
            <p className="field-success">Google encontró: {resolvedAddress}</p>
          )}
          <button
            type="button"
            className="primary"
            onClick={() => {
              onLocation(proposed);
              onMapUrl(
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${proposed.latitude},${proposed.longitude}`)}`,
              );
              setProposed(null);
              setPreviewVisible(false);
              setResolvedAddress("");
              setError("");
            }}
          >
            <Check size={15} /> Confirmar este punto
          </button>
        </>
      )}
      {error && <p className="field-warning">{error}</p>}
    </fieldset>
  );
}
