"use client";

import { useEffect, useState } from "react";
import { Clock3, MapPin, SlidersHorizontal, Truck, UserRound, ChevronRight } from "lucide-react";
import { api } from "./api";
import type { DriverIncident, DriverIncidentReport } from "@/core/driver-incidents";
import type { OperationPolicy } from "@/core/driver-execution-policy";

function ArrivalSettings({ revision }: { revision: number }) {
  const [policy, setPolicy] = useState<OperationPolicy | null>(null);
  const [draft, setDraft] = useState<OperationPolicy | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    api<OperationPolicy>("/api/driver-operation-settings").then(value => {
      if (current) setPolicy(previous => previous && previous.version > value.version ? previous : value);
    }).catch((e: Error) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [revision]);
  const value = draft ?? policy;
  return <details className="arrival-settings">
    <summary><SlidersHorizontal size={16} aria-hidden="true" /> Reglas de llegada</summary>
    <p>El GPS debe ser reciente y preciso. Su margen de error se incluye dentro del radio permitido.</p>
    {value && <form className="incident-filters" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(""); setSaved(false);
      try {
        const next = await api<OperationPolicy>("/api/driver-operation-settings", "PUT", { ...value, expectedVersion: value.version });
        setPolicy(next); setDraft(null); setSaved(true);
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>
      <label>Radio de llegada · metros<input type="number" min={25} max={1000} step={1} required disabled={busy}
        value={value.radiusMeters} onChange={e => { setSaved(false); setDraft({ ...value, radiusMeters: Number(e.target.value) }); }} /></label>
      <label>Error máximo del GPS · metros<input type="number" min={1} max={value.radiusMeters} step={1} required disabled={busy}
        value={value.maxAccuracyMeters} onChange={e => { setSaved(false); setDraft({ ...value, maxAccuracyMeters: Number(e.target.value) }); }} /></label>
      <label>Antigüedad máxima · segundos<input type="number" min={5} max={120} step={1} required disabled={busy}
        value={value.maxSampleAgeSeconds} onChange={e => { setSaved(false); setDraft({ ...value, maxSampleAgeSeconds: Number(e.target.value) }); }} /></label>
      <button type="submit" disabled={busy || !draft}>{busy ? "Guardando…" : "Guardar reglas"}</button>
      {draft && <button type="button" className="quiet" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>Descartar edición</button>}
    </form>}
    {saved && <p role="status">Reglas guardadas. Se aplicarán a las próximas llegadas.</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </details>;
}

function IncidentCard({ incident }: { incident: DriverIncident }) {
  const pointChanged = incident.kind === "location_corrected";
  const detail = incident.details;
  const coordinates = (point: typeof detail.before) => point.latitude === null || point.longitude === null
    ? "Sin ubicación" : `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`;
  return <article className="incident-card">
    <div className={`incident-symbol ${pointChanged ? "" : "late"}`}>
      {pointChanged ? <MapPin size={20} aria-hidden="true" /> : <Clock3 size={20} aria-hidden="true" />}
    </div>
    <div className="incident-content">
      <div className="incident-card-heading">
        <span className={`badge ${pointChanged ? "green" : "amber"}`}>{pointChanged ? "Punto corregido" : "Llegada fuera de horario"}</span>
        <time dateTime={incident.occurredAt}>{new Date(incident.occurredAt).toLocaleString("es-MX", {
          timeZone: incident.timezone, dateStyle: "medium", timeStyle: "short",
        })}</time>
      </div>
      <h3>{detail.customer}</h3><p>{pointChanged ? detail.correctedAddress ?? detail.address : detail.address}</p>
      <div className="incident-meta"><span><UserRound size={14} aria-hidden="true" />{detail.driver}</span>
        <span><Truck size={14} aria-hidden="true" />{detail.vehicle} · {detail.plate}</span></div>
      <p className="incident-orders">{detail.planLabel} · {detail.orders.join(", ")} · Ruta del {detail.serviceDate}</p>
      {pointChanged ? <div className="incident-point-change">
        {detail.correctedAddress && detail.previousAddress && detail.correctedAddress !== detail.previousAddress &&
          <p><small>Dirección anterior:</small> {detail.previousAddress}</p>}
        <span><small>Punto anterior</small>{coordinates(detail.before)}</span><ChevronRight size={16} aria-hidden="true" />
        <a href={`https://www.google.com/maps/search/?api=1&query=${detail.point.latitude},${detail.point.longitude}`} target="_blank" rel="noreferrer">
          <small>Nuevo punto · ver en mapa</small>{coordinates(detail.point)}</a>
      </div> : <p className="incident-lateness">{Math.ceil((detail.lateSeconds ?? 0) / 60)} min después del cierre de recepción. Hora real registrada por el chofer.</p>}
    </div>
  </article>;
}

export function IncidentsPanel({ today, timezone, revision }: { today: string; timezone: string; revision: number }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [driverId, setDriverId] = useState("");
  const [page, setPage] = useState<{ key: string; cursors: string[] }>({ key: "", cursors: [] });
  const filterKey = JSON.stringify([from, to, driverId, revision]);
  const cursors = page.key === filterKey ? page.cursors : [];
  const params = new URLSearchParams({ from, to });
  if (driverId) params.set("driverId", driverId);
  if (cursors.length) params.set("cursor", cursors.at(-1)!);
  const query = params.toString();
  const requestKey = `${query}:${revision}`;
  const [result, setResult] = useState<{ key: string; report: DriverIncidentReport } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  useEffect(() => {
    let current = true;
    api<DriverIncidentReport>(`/api/incidents?${query}`).then(report => {
      if (current) { setResult({ key: requestKey, report }); setFailure(null); }
    }).catch((e: Error) => { if (current) setFailure({ key: requestKey, message: e.message }); });
    return () => { current = false; };
  }, [query, requestKey]);
  const report = result?.key === requestKey ? result.report : null;
  const error = failure?.key === requestKey ? failure.message : "";
  const loading = !report && !error;
  return <section className="panel incidents-panel" aria-label="Incidencias reales de rutas" aria-busy={loading}>
    <div className="panel-body stack">
      <div className="incident-filters">
        <label>Desde<input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
        <label>Hasta<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
        <label>Chofer<select aria-label="Chofer" value={driverId} onChange={e => setDriverId(e.target.value)}>
          <option value="">Todos los choferes</option>
          {(result?.report.drivers ?? []).map(driver => <option value={driver.id} key={driver.id}>{driver.name}{driver.active ? "" : " · inactivo"}</option>)}
        </select></label>
      </div>
      <div className="incident-summary"><span>Fecha del evento · {timezone}</span><span>Actualización automática</span></div>
      <ArrivalSettings revision={revision} />
      {error && <p className="notice error" role="alert">{error}</p>}
      {loading && <p role="status">Consultando incidencias…</p>}
      {report && (report.rows.length ? <div className="incident-feed">{report.rows.map(incident => <IncidentCard key={incident.id} incident={incident} />)}</div>
        : <div className="empty"><Clock3 size={28} aria-hidden="true" /><h2>Sin incidencias en este periodo</h2>
          <p>Los repuntes y las llegadas fuera de horario aparecerán aquí al registrarse. Los pronósticos de Google no generan incidencias.</p></div>)}
      <div className="incident-pagination">
        {cursors.length > 0 && <button type="button" className="quiet" onClick={() => setPage({ key: filterKey, cursors: cursors.slice(0, -1) })}>Anteriores</button>}
        {report?.nextCursor && <button type="button" className="quiet" onClick={() => setPage({ key: filterKey, cursors: [...cursors, report.nextCursor!] })}>Más incidencias<ChevronRight size={14} aria-hidden="true" /></button>}
      </div>
    </div>
  </section>;
}
