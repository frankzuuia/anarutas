"use client";
import { useEffect, useId, useRef, useState } from "react";
import { MapPinned, Save, X } from "lucide-react";
import type { RoutingSettings } from "@/core/routing-contract";
import { api } from "./api";
import {
  CustomerLocationEditor,
  type EditableLocation,
} from "./customer-location-editor";

export function RouteOriginDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (settings: RoutingSettings) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [settings, setSettings] = useState<RoutingSettings | null>(null);
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState<EditableLocation | null>(null);
  const [mapUrl, setMapUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement;
    let active = true;
    element?.showModal();
    api<RoutingSettings>("/api/routing/settings")
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setAddress(value.depotAddress);
        setLocation(value.depotLocation);
        if (value.depotLocation)
          setMapUrl(
            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${value.depotLocation.latitude},${value.depotLocation.longitude}`)}`,
          );
      })
      .catch((caught) => active && setError((caught as Error).message));
    return () => {
      active = false;
      element?.close();
      previous?.focus();
    };
  }, []);

  async function save() {
    if (!settings || !location) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api<RoutingSettings>("/api/routing/settings", "PUT", {
        depotAddress: address,
        depotLocation: location,
        expectedVersion: settings.version,
      });
      onSaved(saved);
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      className="fleet-dialog route-origin-dialog"
      ref={dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="panel-header">
        <h2 id={title}>
          <MapPinned size={18} /> Punto de salida
        </h2>
        <button
          className="quiet"
          aria-label="Cerrar punto de salida"
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="panel-body stack">
        <p className="muted">
          Todas las camionetas comenzarán aquí. La ruta no obliga a regresar a
          este punto.
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {!settings ? (
          <p role="status">Cargando configuración…</p>
        ) : (
          <>
            <label>
              Dirección de salida
              <input
                value={address}
                maxLength={500}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setLocation(null);
                  setMapUrl("");
                }}
              />
            </label>
            <CustomerLocationEditor
              address={address}
              location={location}
              mapUrl={mapUrl}
              onLocation={setLocation}
              onMapUrl={setMapUrl}
              legend="Punto de salida confirmado"
              showMapUrl={false}
            />
            <div className="order-actions">
              <button className="quiet" disabled={busy} onClick={onClose}>
                Cancelar
              </button>
              <button
                className="primary"
                disabled={busy || !address.trim() || !location}
                onClick={() => void save()}
              >
                <Save size={16} />
                {busy ? "Guardando…" : "Guardar salida"}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
