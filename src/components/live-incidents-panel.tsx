"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Radio, UserRound } from "lucide-react";
import type { LiveIncident, LiveIncidentReport } from "@/core/driver-live-incidents";
import { api } from "./api";

const kindNames = { customer_closed: "Negocio cerrado", order_rejected: "Pedido rechazado", rescheduled: "Reprogramado" };
const reasonNames = { poor_quality: "Mala calidad de producto", late_arrival: "Llegada tarde", other: "Otro motivo" };

function Evidence({ incident }: { incident: LiveIncident }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!incident.evidenceExpiresAt) return;
    const remaining = Date.parse(incident.evidenceExpiresAt) - Date.now();
    const timer = setTimeout(() => setHidden(true), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [incident.evidenceExpiresAt]);
  if (hidden || !incident.evidenceId) return incident.kind === "customer_closed"
    ? <p className="muted">Evidencia retirada al resolver o cumplir 24 horas. Se conserva el registro.</p> : null;
  return <a className="live-incident-photo" href={`/api/incidents/evidence/${incident.evidenceId}`} target="_blank" rel="noreferrer">
    <Image src={`/api/incidents/evidence/${incident.evidenceId}`} alt={`Evidencia de negocio cerrado: ${incident.snapshot.customer}`}
      width={240} height={160} unoptimized onError={() => setHidden(true)} />
    <span>Ver evidencia</span>
  </a>;
}

export function LiveIncidentsPanel({ today, timezone, revision }: { today: string; timezone: string; revision: number }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [driverId, setDriverId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState<{ filter: string; value: string } | null>(null);
  const filter = JSON.stringify([from, to, driverId]);
  const params = new URLSearchParams({ from, to });
  if (driverId) params.set("driverId", driverId);
  if (cursor?.filter === filter) params.set("cursor", cursor.value);
  const query = params.toString();
  const [data, setData] = useState<{ query: string; report: LiveIncidentReport } | null>(null);
  const [failure, setFailure] = useState<{ query: string; message: string } | null>(null);
  const [commandFailure, setCommandFailure] = useState<{ query: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<LiveIncident | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (confirm) dialog.current?.showModal(); }, [confirm]);
  useEffect(() => {
    let active = true;
    api<LiveIncidentReport>(`/api/incidents/live?${query}`).then(report => {
      if (active) { setData({ query, report }); setFailure(null); }
    }).catch((e: Error) => { if (active) setFailure({ query, message: e.message }); });
    return () => { active = false; };
  }, [query, revision, refresh]);
  const report = data?.query === query ? data.report : null;
  const error = failure?.query === query ? failure.message : "";
  const groups = Map.groupBy(report?.rows ?? [], row => row.driverId);
  return <section className="panel incidents-panel" aria-label="Seguimiento operativo de rutas">
    <div className="panel-body stack">
      <div className="incident-filters live-incident-filters">
        <label>Desde<input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
        <label>Hasta<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
        <label>Chofer<select aria-label="Chofer" value={driverId} onChange={e => setDriverId(e.target.value)}>
          <option value="">Todos los choferes</option>
          {(data?.report.drivers ?? []).map(driver => <option value={driver.id} key={driver.id}>{driver.name}</option>)}
        </select></label>
      </div>
      <div className="incident-summary"><span>Fecha del evento · {timezone}</span><span>Actualización automática</span></div>
      <section className="live-incidents" aria-label="Incidencias en vivo">
    <div className="live-incident-heading"><div><h2><Radio size={20} aria-hidden="true" /> Incidencias en vivo</h2>
      <p>Negocios cerrados, pedidos rechazados y reprogramaciones, agrupados por chofer.</p></div>
      <span className="badge green">En vivo</span></div>
    <div className="live-incident-metrics" aria-label="Métricas del filtro seleccionado">
      <div><Clock3 size={18} /><strong>{report?.metrics.pending ?? "—"}</strong><span>Pendientes</span></div>
      <div><CheckCircle2 size={18} /><strong>{report?.metrics.completed ?? "—"}</strong><span>Completadas por entrega</span></div>
      <div><CheckCircle2 size={18} /><strong>{report?.metrics.resolved ?? "—"}</strong><span>Resueltas por administración</span></div>
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {commandFailure?.query === query && <p className="notice error" role="alert">{commandFailure.message}</p>}
    {!report && !error && <p role="status">Consultando incidencias en vivo…</p>}
    {report?.rows.length === 0 && <p className="notice">Sin incidencias operativas en el periodo y chofer seleccionados.</p>}
    {Array.from(groups, ([id, incidents]) => <section key={id} className="live-incident-driver" aria-label={`Incidencias de ${incidents[0].snapshot.driver}`}>
      <h3><UserRound size={17} aria-hidden="true" />{incidents[0].snapshot.driver}</h3>
      {incidents.map(incident => <article key={incident.id} className="incident-card live-incident-card">
        <div className={`incident-symbol ${incident.status === "active" ? "late" : ""}`}>
          {incident.status === "active" ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}</div>
        <div className="incident-content"><div className="incident-card-heading">
          <span className={`badge ${incident.status === "active" ? "amber" : "green"}`}>{kindNames[incident.kind]}</span>
          <time dateTime={incident.occurredAt}>{new Date(incident.occurredAt).toLocaleString("es-MX", { timeZone: incident.timezone, dateStyle: "medium", timeStyle: "short" })}</time></div>
          <h3>{incident.snapshot.customer}</h3><p>{incident.snapshot.address}</p>
          <p className="incident-orders">{incident.orders.join(" · ")} · {incident.snapshot.vehicle} · {incident.snapshot.planLabel}</p>
          <p>{incident.status === "completed" ? "Completada · entrega registrada" : incident.status === "resolved_by_admin" ? "Incidencia resuelta por administración"
            : incident.kind === "customer_closed" ? "Pendiente de reintento por el chofer" : incident.kind === "rescheduled" ? "Cerrado en esta ruta · pendiente de gestión interna" : "Rechazado · todavía puede entregarse si el cliente lo solicita"}</p>
          {incident.reasonCode && <p>{reasonNames[incident.reasonCode]}</p>}
          {incident.note && <p className="live-incident-note">{incident.note}</p>}
          <Evidence incident={incident} />
          {incident.canResolve && <button type="button" className="quiet" disabled={busy !== null} onClick={() => setConfirm(incident)}><CheckCircle2 size={16} />Marcar resuelto</button>}
        </div>
      </article>)}
    </section>)}
    <div className="incident-pagination">
      {cursor?.filter === filter && <button className="quiet" onClick={() => setCursor(null)}>Volver al inicio</button>}
      {report?.nextCursor && <button className="quiet" onClick={() => setCursor({ filter, value: report.nextCursor! })}>Más incidencias</button>}
    </div>
    {confirm && <dialog ref={dialog} aria-labelledby="resolve-incident-title" className="live-incident-confirm"
      onCancel={event => { event.preventDefault(); if (!busy) setConfirm(null); }}>
      <h2 id="resolve-incident-title">¿Marcar incidencia resuelta?</h2><p>{confirm.snapshot.customer} · {confirm.orders.join(", ")}</p>
      <p>Esto cierra la gestión de la incidencia. No registra una entrega, no reabre el pedido y no liquida la ruta.</p>
      <div className="toolbar"><button disabled={busy !== null} onClick={async () => {
        setBusy(confirm.id);
        setCommandFailure(null);
        try { await api(`/api/incidents/live/${confirm.id}/resolve`, "POST", { expectedVersion: confirm.version }); setConfirm(null); setRefresh(value => value + 1); }
        catch (e) { setCommandFailure({ query, message: (e as Error).message }); setConfirm(null); setRefresh(value => value + 1); }
        finally { setBusy(null); }
      }}>{busy ? "Guardando…" : "Confirmar resuelto"}</button>
      <button className="quiet" disabled={busy !== null} onClick={() => setConfirm(null)}>Cancelar</button></div>
    </dialog>}
      </section>
    </div>
  </section>;
}
