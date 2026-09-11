"use client";
import { useEffect, useId, useRef, useState } from "react";
import { MapPinned, Save, X } from "lucide-react";
import type { RoutingSettings } from "@/core/routing-contract";
import type { Plan } from "@/core/plans";
import { api } from "./api";
import {
  CustomerLocationEditor,
  type EditableLocation,
} from "./customer-location-editor";

export function RouteOriginDialog({
  plan,
  onPlan,
  onClose,
  onSaved,
}: {
  plan: Plan;
  onPlan: (plan: Plan) => void;
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
  const [departure, setDeparture] = useState(() =>
    plan.departure_minute == null
      ? ""
      : `${String(Math.floor(plan.departure_minute / 60)).padStart(2, "0")}:${String(plan.departure_minute % 60).padStart(2, "0")}`,
  );
  const [hourBusy, setHourBusy] = useState(false);
  const [hourNotice, setHourNotice] = useState("");

  async function saveHour() {
    setHourBusy(true);
    setError("");
    setHourNotice("");
    try {
      const saved = await api<Plan>(`/api/plans/${plan.id}/departure`, "PUT", {
        departureTime: departure,
        expectedVersion: plan.version,
      });
      onPlan(saved);
      setHourNotice("Horario guardado para este plan.");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setHourBusy(false);
    }
  }

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
        if (!busy && !hourBusy) onClose();
      }}
    >
      <header className="panel-header">
        <h2 id={title}>
          <MapPinned size={18} /> Salida y horario
        </h2>
        <button
          className="quiet"
          aria-label="Cerrar punto de salida"
          disabled={busy || hourBusy}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="panel-body stack">
        <p className="muted">
          Todas las camionetas salen de esta bodega y regresan al mismo punto al terminar sus entregas.
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={busy || hourBusy}>
          <legend>Horario de salida · {plan.label}</legend>
          <label>
            Hora de salida · 24 horas
            <input
              value={departure}
              inputMode="numeric"
              maxLength={5}
              placeholder="HH:mm"
              aria-label="Hora de salida del plan"
              onChange={(event) => {
                setDeparture(event.target.value);
                setHourNotice("");
              }}
            />
          </label>
          <p className="field-hint">
            Todas las camionetas de este plan comienzan a esta hora. El
            administrador puede cambiarla.
          </p>
          <button
            className="quiet"
            disabled={!departure || hourBusy}
            onClick={() => void saveHour()}
          >
            <Save size={15} />{" "}
            {hourBusy ? "Guardando horario…" : "Guardar horario"}
          </button>
          {hourNotice && (
            <p className="small" role="status">
              {hourNotice}
            </p>
          )}
        </fieldset>
        {!settings ? (
          <p role="status">Cargando configuración…</p>
        ) : (
          <>
            <label>
              Dirección de salida
              <input
                value={address}
                maxLength={500}
                placeholder="Calle, número, colonia, ciudad, estado y país"
                onChange={(event) => {
                  setAddress(event.target.value);
                  setLocation(null);
                  setMapUrl("");
                }}
              />
              <span className="field-hint">
                Escribe el domicilio completo. Ejemplo: Calle 5 1106, Colonia
                Industrial, Guadalajara, Jalisco, México.
              </span>
            </label>
            <CustomerLocationEditor
              address={address}
              location={location}
              mapUrl={mapUrl}
              onLocation={setLocation}
              onMapUrl={setMapUrl}
              legend="Punto de salida confirmado"
              showMapUrl={false}
              requirePreciseResult
              geocodeRegion="mx"
              geocodeCountry="MX"
              onResolvedAddress={setAddress}
            />
            <div className="order-actions">
              <button
                className="quiet"
                disabled={busy || hourBusy}
                onClick={onClose}
              >
                Cancelar
              </button>
              <button
                className="primary"
                disabled={busy || hourBusy || !address.trim() || !location}
                onClick={() => void save()}
              >
                <Save size={16} />
                {busy ? "Guardando…" : "Guardar punto de salida"}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
