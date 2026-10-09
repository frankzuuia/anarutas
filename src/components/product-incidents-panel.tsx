"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Download, PackageSearch, Pencil, Trash2 } from "lucide-react";
import Image from "next/image";
import type { ProductIncident, ProductIncidentReport } from "@/core/product-incidents";
import { productIncidentNames, warehouseReasonNames } from "@/core/product-incidents-policy";
import { api } from "./api";

function ProductEvidence({ incident }: { incident: ProductIncident }) {
  const photos = incident.evidenceIds ?? (incident.evidenceId ? [incident.evidenceId] : []);
  if (!photos.length) return <small>Sin fotografía</small>;
  return <div className="product-evidence-gallery">{photos.map((photoId, index) =>
    <ProductEvidencePhoto key={photoId} incident={incident} photoId={photoId} index={index} count={photos.length} />)}</div>;
}
function ProductEvidencePhoto({ incident, photoId, index, count }: { incident: ProductIncident; photoId: string; index: number; count: number }) {
  const [failed, setFailed] = useState(false);
  const url = `/api/incidents/products/${incident.id}/evidence?photoId=${encodeURIComponent(photoId)}`;
  return <a className="product-evidence" href={url} target="_blank" rel="noreferrer">
    {!failed && <Image unoptimized src={url} width={88} height={60} alt={`Evidencia: ${incident.product}${count > 1 ? ` · ${index + 1} de ${count}` : ""}`}
      onError={() => setFailed(true)} />}
    <span>{failed ? "Reintentar abrir evidencia" : count > 1 ? `Foto ${index + 1} de ${count}` : "Ver evidencia"}</span>
  </a>;
}

export function ProductIncidentsPanel({ from, to, driverId, revision, live = false }: {
  from?: string; to?: string; driverId: string; revision: number; live?: boolean;
}) {
  const params = new URLSearchParams();
  if (!live && from) params.set("from", from);
  if (!live && to) params.set("to", to);
  if (driverId) params.set("driverId", driverId);
  if (live) params.set("live", "true");
  const filter = params.toString();
  const [page, setPage] = useState<{ filter: string; cursor: string } | null>(null);
  if (page?.filter === filter) params.set("cursor", page.cursor);
  const query = params.toString();
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<{ query: string; report: ProductIncidentReport } | null>(null);
  const [failure, setFailure] = useState<{ query: string; message: string } | null>(null);
  const [selected, setSelected] = useState<ProductIncident | null>(null);
  const [note, setNote] = useState("");
  const [action, setAction] = useState<"classification" | "resolve" | "cancel">("resolve");
  const editing = action === "classification", removing = action === "cancel";
  const [department, setDepartment] = useState("");
  const [concept, setConcept] = useState("");
  const [comment, setComment] = useState("");
  const [commandError, setCommandError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    if (!selected) return;
    const trigger = document.activeElement;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>('button[type="button"]')?.focus();
    return () => { if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); };
  }, [selected]);
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      if (controller || document.visibilityState === "hidden") return;
      controller = new AbortController();
      timeout = setTimeout(() => controller?.abort(), 15_000);
      api<ProductIncidentReport>(`/api/incidents/products?${query}`, "GET", undefined, controller.signal)
        .then(report => { if (active) { setData({ query, report }); setFailure(null); } })
        .catch((error: Error) => { if (active) setFailure({ query, message: error.name === "AbortError" ? "Consulta interrumpida. Reintentando…" : error.message }); })
        .finally(() => { if (timeout) clearTimeout(timeout); controller = null; });
    };
    read();
    const timer = setInterval(read, 15_000);
    window.addEventListener("online", read);
    document.addEventListener("visibilitychange", read);
    return () => { active = false; clearInterval(timer); if (timeout) clearTimeout(timeout); controller?.abort();
      window.removeEventListener("online", read); document.removeEventListener("visibilitychange", read); };
  }, [query, revision, refresh]);
  const report = data?.query === query ? data.report : null;
  return <section className="product-incidents" aria-label={live ? "Reposiciones pendientes" : "Incidencias por producto"}>
    <div className="toolbar product-incidents-heading"><h3><PackageSearch size={16} />{live ? "Reposiciones pendientes" : "Incidencias por producto"}</h3>
      {live && <span className="badge amber">{report?.pending ?? "—"} pendientes</span>}
      {!live && <a className="button quiet" href={`/api/incidents/products/export?${filter}`}><Download size={15} />Exportar Excel</a>}
    </div>
    {failure?.query === query && <p role="alert" className="notice error">{failure.message}</p>}
    {commandError && <p role="alert" className="notice error">{commandError}</p>}
    {!report && !failure && <p role="status">Consultando productos…</p>}
    {report && !report.rows.length && <p className="muted">{live ? "Sin reposiciones pendientes." : "Sin incidencias de producto en este periodo."}</p>}
    {report && report.rows.length > 0 && <div className="product-incidents-scroll"><table>
      <thead><tr><th>Fecha</th><th>Pedido / cliente</th><th>Cantidad</th><th>Producto</th>{!live && <th>Departamento / concepto</th>}<th>{live ? "Notas / seguimiento" : "Comentarios / evidencia"}</th>{!live && <th aria-label="Acciones" />}</tr></thead>
      <tbody>{report.rows.map(row => <tr key={row.id}>
        <td><time dateTime={row.occurredAt}>{new Date(row.occurredAt).toLocaleString("es-MX", { timeZone: row.timezone, dateStyle: "short", timeStyle: "short" })}</time></td>
        <td><strong>{row.orderName}</strong><span>{row.snapshot.customer}</span><small>Reportó: {row.snapshot.driver}</small></td>
        <td className="product-quantity">{Number(row.quantity).toLocaleString("es-MX", { maximumFractionDigits: 6 })} {row.unit}</td>
        <td><strong>{row.product}</strong><small>{productIncidentNames[row.kind]}{row.warehouseReason ? ` · ${warehouseReasonNames[row.warehouseReason]}` : ""}</small></td>
        {!live && <td><span>{row.department || "Sin departamento"}</span><small>{row.concept || "Concepto por clasificar"}</small>
          {row.status !== "canceled" && <button className="quiet" onClick={() => { setAction("classification"); setSelected(row); setDepartment(row.department ?? ""); setConcept(row.concept ?? ""); setComment(row.note ?? ""); setCommandError(""); }}>
            <Pencil size={13} />Editar clasificación</button>}</td>}
        <td><span className="product-incident-note">{row.note || "Sin notas"}</span>
          <ProductEvidence incident={row} />
          {row.status === "resolved" ? <small>Resuelta · {row.resolutionNote}</small> : row.status === "canceled" ? <small>Cancelada por el chofer · fuera del Excel</small> : live && <button className="quiet product-incident-resolve" onClick={() => { setAction("resolve"); setSelected(row); setNote(""); setCommandError(""); }}><CheckCircle2 size={16} />Resolver</button>}
        </td>
        {!live && <td>{row.status !== "canceled" && <button className="danger product-incident-delete"
          aria-label={`Eliminar incidencia de ${row.product} · ${row.orderName}`} title="Eliminar incidencia" disabled={busy}
          onClick={() => { setAction("cancel"); setSelected(row); setCommandError(""); }}><Trash2 size={16} /></button>}</td>}
      </tr>)}</tbody>
    </table></div>}
    <div className="incident-pagination">
      {page?.filter === filter && <button className="quiet" onClick={() => setPage(null)}>Volver al inicio</button>}
      {report?.nextCursor && <button className="quiet" onClick={() => setPage({ filter, cursor: report.nextCursor! })}>Más productos</button>}
    </div>
    {selected && <dialog ref={dialog} className="fleet-dialog live-incident-confirm product-incident-dialog" aria-label={removing ? "Eliminar incidencia de producto" : editing ? "Editar clasificación" : "Resolver incidencia de producto"} aria-describedby={`${title}-description`}
      onCancel={event => { event.preventDefault(); if (!busy) setSelected(null); }}>
      <h2 id={title}>{removing ? "Eliminar incidencia de producto" : editing ? "Editar clasificación" : "Resolver incidencia de producto"}</h2>
      <p>{selected.orderName} · {selected.product} · {Number(selected.quantity)} {selected.unit}</p>
      <p id={`${title}-description`}>{removing ? "Se retirará del panel y del Excel. Si el pedido sigue abierto en una ruta activa, se restablecerá la cantidad correspondiente. Si ya está cerrado o la ruta fue cancelada, sus cantidades y su historial se conservarán tal como quedaron."
        : editing ? "Departamento se usará en el Excel; Concepto es interno. La corrección quedará auditada y conservará el reporte original del chofer."
        : "Registra cómo se atendió. No cambia el pedido, inventario ni contabilidad de Odoo."}</p>
      <form onSubmit={async event => {
        event.preventDefault(); setBusy(true);
        try { await api(`/api/incidents/products/${selected.id}${removing ? "" : `/${action}`}`, removing ? "DELETE" : editing ? "PATCH" : "POST",
          { expectedVersion: selected.version, ...(removing ? {} : editing ? { department, concept, comment } : { note }) });
          setSelected(null); setRefresh(value => value + 1); }
        catch (error) { setCommandError((error as Error).message); setSelected(null); setRefresh(value => value + 1); }
        finally { setBusy(false); }
      }}>
        {editing ? <div className="stack">
          <label>Departamento<input required maxLength={120} list={`${title}-departments`} value={department} onChange={e => setDepartment(e.target.value)} disabled={busy} /></label>
          <datalist id={`${title}-departments`}><option value="Operaciones" /><option value="Compras" /><option value="Ventas" /></datalist>
          <label>Concepto<input required maxLength={120} list={`${title}-concepts`} value={concept} onChange={e => setConcept(e.target.value)} disabled={busy} /></label>
          <datalist id={`${title}-concepts`}>{["Reparto", "Picking", "Especiales", "Error en compra", "Error_en_compra"].map(value => <option key={value} value={value} />)}</datalist>
          <label>Comentarios<textarea aria-label="Comentarios" maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} disabled={busy} /></label>
          <details><summary>Comentario original del chofer</summary><p className="product-incident-note">{selected.originalNote || "Sin comentario"}</p></details>
        </div> : !removing && <label>Cómo se resolvió<textarea required maxLength={2000} value={note} onChange={event => setNote(event.target.value)} disabled={busy} /></label>}
        <div className="toolbar"><button className={removing ? "danger" : undefined} disabled={busy || (editing ? !department.trim() || !concept.trim() : !removing && !note.trim())}>{busy ? "Guardando…" : removing ? "Eliminar incidencia" : editing ? "Guardar clasificación" : "Confirmar resolución"}</button>
          <button type="button" className="quiet" disabled={busy} onClick={() => setSelected(null)}>{removing ? "Conservar incidencia" : "Cancelar"}</button></div>
      </form>
    </dialog>}
  </section>;
}
