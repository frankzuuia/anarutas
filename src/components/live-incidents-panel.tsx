"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Radio,
  UserRound,
  Volume2,
} from "lucide-react";
import type {
  IncidentBoardReport,
  IncidentBoardRow,
  IncidentAlertSettings,
} from "@/core/incident-board";
import {
  incidentGroup,
  liveIncidentGroups,
} from "@/core/incident-board-policy";
import {
  productIncidentNames,
  warehouseReasonNames,
} from "@/core/product-incidents-policy";
import { api } from "./api";
import { ArrivalSettings } from "./incidents-panel";
import {
  activateIncidentAlarm,
  incidentSeenChanged,
  useIncidentAlarm,
} from "./incident-alarm";

const serviceNames: Record<string, string> = {
  customer_closed: "Cliente cerrado",
  order_rejected: "Pedido rechazado",
  rescheduled: "Reprogramado",
  late_arrival: "Llegada fuera de horario",
  location_corrected: "Punto corregido",
};
const reasonNames: Record<string, string> = {
  poor_quality: "Mala calidad de producto",
  late_arrival: "Llegada tarde",
  other: "Otro motivo",
};
type Section = "routes" | "resolved" | "late" | "location";
const returnStatusNames: Record<string, string> = {
  awaiting_collection: "Se enviará al confirmar el cobro",
  queued: "Pendiente de envío",
  sending: "Enviando devolución",
  uncertain: "Comprobando resultado del envío",
  prepared: "Devolución creada · Validación manual",
  review: "Requiere revisión",
};

function Evidence({ row }: { row: IncidentBoardRow }) {
  const [failed, setFailed] = useState<string[]>([]);
  return (
    <div className="product-evidence-gallery">
      {row.detail.photos.map((id, index) => {
        const url =
          row.source === "product"
            ? `/api/incidents/products/${row.id}/evidence?photoId=${encodeURIComponent(id)}`
            : `/api/incidents/evidence/${id}`;
        return (
          <a
            key={id}
            className="product-evidence"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            {!failed.includes(id) && (
              <Image
                unoptimized
                src={url}
                width={88}
                height={60}
                alt={`Evidencia de ${row.detail.customer} · ${index + 1}`}
                onError={() => setFailed((previous) => [...previous, id])}
              />
            )}
            <span>
              {failed.includes(id)
                ? "Consultar disponibilidad de evidencia"
                : `Ver foto ${index + 1}`}
            </span>
          </a>
        );
      })}
    </div>
  );
}

function IncidentCard({
  row,
  busy,
  onSeen,
  onResolve,
}: {
  row: IncidentBoardRow;
  busy: boolean;
  onSeen: () => void;
  onResolve: () => void;
}) {
  const isNew = row.notification !== null && row.notification.seenAt === null;
  const name =
    productIncidentNames[row.kind as keyof typeof productIncidentNames] ??
    serviceNames[row.kind];
  const detail = row.detail;
  return (
    <article
      className={`incident-card live-incident-card ${isNew ? "incident-unseen" : ""}`}
      data-incident-key={row.key}
    >
      <div className="incident-symbol late">
        {row.kind === "late_arrival" ? (
          <Clock3 size={20} />
        ) : (
          <AlertTriangle size={20} />
        )}
      </div>
      <div className="incident-content">
        <div className="incident-card-heading">
          <span className="badge amber">{name}</span>
          <h3>{detail.customer}</h3>
          <time dateTime={row.occurredAt}>
            {new Date(row.occurredAt).toLocaleString("es-MX", {
              timeZone: row.timezone,
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
        </div>
        <div className="live-incident-facts">
          <p className="incident-orders">
            {detail.orders.join(" · ")} · {detail.vehicle} · {detail.plate}
          </p>
          {detail.product && (
            <p>
              <strong>{detail.product}</strong> ·{" "}
              {Number(detail.quantity).toLocaleString("es-MX", {
                maximumFractionDigits: 6,
              })}{" "}
              {detail.unit}
            </p>
          )}
        </div>
        {detail.warehouseReason && (
          <p>
            {
              warehouseReasonNames[
                detail.warehouseReason as keyof typeof warehouseReasonNames
              ]
            }
          </p>
        )}
        {detail.reasonCode && <p>{reasonNames[detail.reasonCode]}</p>}
        {detail.note && <p className="live-incident-note">{detail.note}</p>}
        {detail.resolutionNote && (
          <p className="live-incident-resolution">
            <strong>Resolución:</strong> {detail.resolutionNote}
          </p>
        )}
        {row.odooReturn && (
          <p className="muted" role="status">
            Odoo · {returnStatusNames[row.odooReturn.status] ?? "Pendiente"}
            {row.odooReturn.reference && <> · {row.odooReturn.reference}</>}
            {row.odooReturn.error && <> · {row.odooReturn.error}</>}
          </p>
        )}
        {row.kind === "late_arrival" && (
          <p>
            {Math.ceil((detail.lateSeconds ?? 0) / 60)} min después del cierre
            de recepción. Hora real registrada por el chofer.
          </p>
        )}
        <div className="live-incident-controls">
          <details className="live-incident-extra">
            <summary>Ver detalles</summary>
            <div>
              {detail.note && (
                <p className="live-incident-full-note">{detail.note}</p>
              )}
              <p>
                {detail.planLabel} · {detail.address}
              </p>
              {row.kind === "location_corrected" && (
                <p>
                  Dirección anterior: {detail.previousAddress ?? detail.address}
                  <br />
                  Dirección corregida:{" "}
                  {detail.correctedAddress ?? detail.address}
                  {detail.point && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={`https://www.google.com/maps/search/?api=1&query=${detail.point.latitude},${detail.point.longitude}`}
                      >
                        Ver punto confirmado
                      </a>
                    </>
                  )}
                </p>
              )}
              {row.source === "service" && (
                <p>
                  {row.status === "completed"
                    ? "Completada · entrega registrada"
                    : row.status === "resolved_by_admin"
                      ? "Incidencia resuelta por administración"
                      : row.kind === "customer_closed"
                        ? "Pendiente de reintento por el chofer"
                        : row.kind === "rescheduled"
                          ? "Cerrado en esta ruta · pendiente de gestión interna"
                          : "Rechazado · todavía puede entregarse si el cliente lo solicita"}
                </p>
              )}
              <Evidence row={row} />
            </div>
          </details>
          <div className="toolbar incident-seen-actions">
            {row.notification && (
              <label>
                <input
                  type="checkbox"
                  checked={!isNew}
                  disabled={busy || !isNew}
                  onChange={onSeen}
                />
                Visto
              </label>
            )}
            {row.notification?.seenBy && (
              <small>Visto por {row.notification.seenBy}</small>
            )}
            {detail.canResolve && (
              <button
                type="button"
                className="quiet product-incident-resolve"
                disabled={busy}
                onClick={onResolve}
              >
                <CheckCircle2 size={15} />
                Marcar resuelto
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function BoardSection({
  section,
  filter,
  revision,
  refresh,
  onChange,
  onReport,
}: {
  section: Section;
  filter: string;
  revision: number;
  refresh: number;
  onChange: () => void;
  onReport?: (report: IncidentBoardReport) => void;
}) {
  const [page, setPage] = useState<{ filter: string; cursor: string } | null>(
    null,
  );
  const [data, setData] = useState<{
    query: string;
    report: IncidentBoardReport;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<IncidentBoardRow | null>(null);
  const [note, setNote] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    title = useId();
  const reportCallback = useRef(onReport);
  useEffect(() => {
    reportCallback.current = onReport;
  }, [onReport]);
  const params = new URLSearchParams(filter);
  params.set("section", section);
  if (page?.filter === filter) params.set("cursor", page.cursor);
  const query = params.toString();
  useEffect(() => {
    if (selected) dialog.current?.showModal();
  }, [selected]);
  useEffect(() => {
    let active = true,
      pending: AbortController | null = null;
    const read = () => {
      if (pending) return;
      const controller = new AbortController();
      pending = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      api<IncidentBoardReport>(
        `/api/incidents/board?${query}`,
        "GET",
        undefined,
        controller.signal,
      )
        .then((report) => {
          if (active) {
            setData({ query, report });
            setError("");
            reportCallback.current?.(report);
          }
        })
        .catch((e: Error) => {
          if (active)
            setError(
              e.name === "AbortError"
                ? "Consulta interrumpida; se reintentará automáticamente."
                : e.message,
            );
        })
        .finally(() => {
          clearTimeout(timeout);
          pending = null;
        });
    };
    read();
    const interval = setInterval(read, 15000);
    window.addEventListener("focus", read);
    window.addEventListener("online", read);
    return () => {
      active = false;
      clearInterval(interval);
      pending?.abort();
      window.removeEventListener("focus", read);
      window.removeEventListener("online", read);
    };
  }, [query, revision, refresh]);
  const report = data?.query === query ? data.report : null;
  const grouped = Map.groupBy(report?.rows ?? [], (row) => row.driverId);
  const sectionName =
    section === "routes"
      ? "Incidencias de ruta"
      : section === "resolved"
        ? "Resueltas"
        : section === "late"
          ? "Llegadas fuera de horario"
          : "Puntos corregidos";
  return (
    <section
      className={`incident-board-section incident-board-${section}`}
      aria-label={sectionName}
    >
      <div className="toolbar">
        <h3>{sectionName}</h3>
        <span className="badge">{report?.total ?? "—"}</span>
        {!!report?.unseen && (
          <span className="badge red">{report.unseen} sin ver</span>
        )}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!report && !error && <p role="status">Consultando incidencias…</p>}
      {report?.rows.length === 0 && (
        <p className="muted">
          Sin incidencias en este apartado para el filtro seleccionado.
        </p>
      )}
      {Array.from(grouped, ([driver, rows]) => (
        <section
          className="live-incident-driver"
          key={driver}
          aria-label={`Incidencias de ${rows[0].detail.driver}`}
        >
          <h3>
            <UserRound size={17} />
            {rows[0].detail.driver}
          </h3>
          {liveIncidentGroups.map((group) => {
            const incidents = rows.filter(
              (row) => incidentGroup(row.kind) === group.label,
            );
            if (!incidents.length) return null;
            return (
              <section
                key={group.label}
                aria-label={group.label}
                className="incident-type-group"
              >
                <h4>
                  {group.label} · {incidents.length}
                </h4>
                {incidents.map((row) => (
                  <IncidentCard
                    key={row.key}
                    row={row}
                    busy={busy}
                    onResolve={() => {
                      setSelected(row);
                      setNote("");
                    }}
                    onSeen={async () => {
                      setBusy(true);
                      try {
                        await api("/api/incidents/seen", "POST", {
                          key: row.key,
                        });
                        incidentSeenChanged();
                        onChange();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                ))}
              </section>
            );
          })}
        </section>
      ))}
      <div className="incident-pagination">
        {page?.filter === filter && (
          <button className="quiet" onClick={() => setPage(null)}>
            Volver al inicio
          </button>
        )}
        {report?.nextCursor && (
          <button
            className="quiet"
            onClick={() => setPage({ filter, cursor: report.nextCursor! })}
          >
            Más incidencias
          </button>
        )}
      </div>
      {selected && (
        <dialog
          ref={dialog}
          className="fleet-dialog live-incident-confirm product-incident-dialog"
          aria-labelledby={title}
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) setSelected(null);
          }}
        >
          <h2 id={title}>Resolver incidencia</h2>
          <p>
            {selected.detail.customer} · {selected.detail.orders.join(" · ")}
          </p>
          <p>
            Registra la atención administrativa. Marcar Visto sólo confirma
            lectura y se hace por separado.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const path =
                  selected.source === "product"
                    ? `/api/incidents/products/${selected.id}/resolve`
                    : `/api/incidents/live/${selected.id}/resolve`;
                await api(path, "POST", {
                  expectedVersion: selected.version,
                  ...(selected.source === "product" ? { note } : {}),
                });
                setSelected(null);
                onChange();
                incidentSeenChanged();
              } catch (error) {
                setError((error as Error).message);
                setSelected(null);
                onChange();
              } finally {
                setBusy(false);
              }
            }}
          >
            {selected.source === "product" && (
              <label>
                Cómo se resolvió
                <textarea
                  required
                  maxLength={2000}
                  value={note}
                  disabled={busy}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            )}
            <div className="toolbar">
              <button
                disabled={
                  busy || (selected.source === "product" && !note.trim())
                }
              >
                Confirmar resolución
              </button>
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </dialog>
      )}
    </section>
  );
}

export function LiveIncidentsPanel({
  revision,
  selectedDriverId,
  onDriverChange,
  compact = false,
}: {
  revision: number;
  selectedDriverId?: string;
  onDriverChange?: (id: string) => void;
  compact?: boolean;
}) {
  const [localDriver, setLocalDriver] = useState("");
  const driverId = selectedDriverId ?? localDriver,
    setDriver = onDriverChange ?? setLocalDriver;
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<IncidentBoardReport | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [saving, setSaving] = useState(false);
  const alarm = useIncidentAlarm(revision + refresh);
  const params = new URLSearchParams();
  if (driverId) params.set("driverId", driverId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const filter = params.toString();
  const changed = () => setRefresh((value) => value + 1);
  return (
    <section
      className={`panel incidents-panel ${compact ? "embedded-live-incidents" : ""}`}
      aria-label="Seguimiento operativo de rutas"
    >
      <div className="panel-body stack">
        <div className="live-incident-heading">
          <h2>
            <Radio size={19} />
            Incidencias en vivo
          </h2>
        </div>
        <div className="incident-filters">
          <label>
            Chofer
            <select
              aria-label="Chofer"
              value={driverId}
              onChange={(e) => setDriver(e.target.value)}
            >
              <option value="">Todos los choferes</option>
              {report?.drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Desde
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <div className="incident-alarm-bar">
          <div className="toolbar">
            <button
              type="button"
              className="quiet"
              onClick={() => void activateIncidentAlarm()}
              disabled={alarm.playing}
            >
              <Volume2 size={16} />
              {alarm.enabled ? "Probar sonido" : "Activar sonido"}
            </button>
            <span className={`badge ${alarm.enabled ? "green" : "amber"}`}>
              {alarm.enabled ? "Sonido activo" : "Sonido desactivado"}
            </span>
          </div>
          <p role="status">
            {alarm.playing ? "Reproduciendo alarma…" : alarm.message}
          </p>
        </div>
        <details className="incident-alarm-settings">
          <summary>
            <Volume2 size={16} />
            Configuración de alarma
          </summary>
          <div className="toolbar">
            <label>
              Duración de alarma
              <select
                aria-label="Duración de alarma"
                value={alarm.settings?.seconds ?? 5}
                disabled={saving || !alarm.settings}
                onChange={async (e) => {
                  setSaving(true);
                  setSettingsError("");
                  try {
                    await api<IncidentAlertSettings>(
                      "/api/incidents/alerts",
                      "PUT",
                      {
                        seconds: Number(e.target.value),
                        expectedVersion: alarm.settings!.version,
                      },
                    );
                    changed();
                  } catch (error) {
                    setSettingsError((error as Error).message);
                    changed();
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {[5, 10, 15].map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} segundos
                  </option>
                ))}
              </select>
            </label>
          </div>
          {settingsError && (
            <p className="notice error" role="alert">
              {settingsError}
            </p>
          )}
        </details>
        {!!report?.outsideFilter && (
          <p className="notice incident-unseen">
            {report.outsideFilter} incidencias sin ver fuera del filtro.{" "}
            <button
              className="quiet"
              onClick={() => {
                setDriver("");
                setFrom("");
                setTo("");
              }}
            >
              Mostrar todos
            </button>
          </p>
        )}
        <BoardSection
          section="routes"
          filter={filter}
          revision={revision}
          refresh={refresh}
          onChange={changed}
          onReport={setReport}
        />
        <BoardSection
          section="resolved"
          filter={filter}
          revision={revision}
          refresh={refresh}
          onChange={changed}
        />
        <BoardSection
          section="late"
          filter={filter}
          revision={revision}
          refresh={refresh}
          onChange={changed}
        />
        <details className="incident-operational">
          <summary>Puntos corregidos y reglas de llegada</summary>
          <ArrivalSettings revision={revision} />
          <BoardSection
            section="location"
            filter={filter}
            revision={revision}
            refresh={refresh}
            onChange={changed}
          />
        </details>
      </div>
    </section>
  );
}
