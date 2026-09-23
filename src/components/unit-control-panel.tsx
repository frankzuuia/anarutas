"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Camera, ChevronLeft, Truck } from "lucide-react";
import { api } from "./api";
import type { Vehicle } from "@/core/fleet-contract";

type UnitPhoto = {
  id: string;
  planId: string;
  vehicleId: string;
  createdAt: string;
  expiresAt: string;
  bytes: number;
  planLabel: string;
  serviceDate: string;
};

export function UnitControlPanel({ today, timezone, revision }: { today: string; timezone: string; revision: number }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [date, setDate] = useState(today);
  const [photos, setPhotos] = useState<UnitPhoto[]>([]);
  const [openPhoto, setOpenPhoto] = useState<UnitPhoto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const selectedId = selected?.id;
  const photosByPlan = new Map<string, UnitPhoto[]>();
  for (const photo of photos) {
    const group = photosByPlan.get(photo.planId) ?? [];
    group.push(photo);
    photosByPlan.set(photo.planId, group);
  }

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const fleet = await api<Vehicle[]>("/api/vehicles");
        const current = selectedId ? fleet.find((vehicle) => vehicle.id === selectedId && vehicle.available) : null;
        const nextPhotos = current
          ? await api<UnitPhoto[]>(`/api/vehicles/${current.id}/unit-photos?date=${encodeURIComponent(date)}`)
          : [];
        if (!live) return;
        setVehicles(fleet.filter((vehicle) => vehicle.available));
        if (selectedId) setSelected(current ?? null);
        setPhotos(nextPhotos);
        setError("");
      } catch (cause) {
        if (live) setError((cause as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    }
    void load();
    return () => { live = false; };
  }, [selectedId, date, revision]);

  const choose = (vehicle: Vehicle) => {
    setLoading(true);
    setSelected(vehicle);
    setPhotos([]);
    setOpenPhoto(null);
  };

  return (
    <section className="unit-control" aria-label="Control de unidades">
      {error && <p className="notice error" role="alert">{error}</p>}
      {!selected ? (
        <div className="unit-grid">
          {vehicles.map((vehicle) => (
            <button className="unit-card" type="button" key={vehicle.id} onClick={() => choose(vehicle)}>
              <span className="unit-card-icon"><Truck size={20} aria-hidden="true" /></span>
              <span className="unit-card-copy">
                <strong>{vehicle.name}</strong>
                <small>{vehicle.plate || "Sin placas"} · {vehicle.driver_name || "Sin chofer"}</small>
              </span>
              <span className="unit-card-action">Ver fotos</span>
            </button>
          ))}
          {!loading && vehicles.length === 0 && (
            <p className="muted">No hay camionetas activas. Activa una desde Camionetas para verla aquí.</p>
          )}
        </div>
      ) : (
        <div className="unit-detail">
          <div className="unit-detail-heading">
            <button className="quiet" type="button" onClick={() => { setSelected(null); setOpenPhoto(null); }}>
              <ChevronLeft size={15} aria-hidden="true" /> Unidades
            </button>
            <div><h2>{selected.name}</h2><p>{selected.plate || "Sin placas"} · {selected.driver_name || "Sin chofer"}</p></div>
            <label className="unit-date">Fecha <input type="date" value={date} onChange={(event) => { setLoading(true); setDate(event.target.value); }} /></label>
          </div>
          {loading ? <p className="muted">Consultando fotos…</p> : photos.length ? (
            <div className="unit-photo-groups">
              {Array.from(photosByPlan, ([planId, group]) => (
                <section className="unit-photo-group" key={planId} aria-label={`Fotos de ${group[0].planLabel}`}>
                  <div className="unit-photo-group-heading">
                    <h3>{group[0].planLabel}</h3>
                    <span>{group[0].serviceDate} · {group.length} {group.length === 1 ? "foto" : "fotos"}</span>
                  </div>
                  <div className="unit-photo-grid">
                    {group.map((photo) => (
                      <button type="button" className="unit-photo" key={photo.id} onClick={() => setOpenPhoto(photo)}
                        aria-label={`Abrir foto de ${photo.planLabel} del ${new Date(photo.createdAt).toLocaleString("es-MX", { timeZone: timezone })}`}>
                        <Image unoptimized src={`/api/unit-photos/${photo.id}`} alt="Fotografía de la unidad" width={280} height={200} />
                        <span>{new Date(photo.createdAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: timezone })}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : <div className="unit-empty"><Camera size={20} aria-hidden="true" /><strong>Sin fotos para esta fecha</strong><span>Las capturas del chofer aparecerán aquí después de publicarse su ruta.</span></div>}
        </div>
      )}
      {openPhoto && (
        <div className="unit-lightbox" role="presentation" onClick={() => setOpenPhoto(null)}>
          <div className="unit-lightbox-content" role="dialog" aria-modal="true" aria-label="Foto de la camioneta" onClick={(event) => event.stopPropagation()}>
            <button className="quiet" type="button" onClick={() => setOpenPhoto(null)}>Cerrar</button>
            <Image unoptimized src={`/api/unit-photos/${openPhoto.id}`} alt="Fotografía ampliada de la unidad" width={1100} height={825} />
          </div>
        </div>
      )}
    </section>
  );
}
