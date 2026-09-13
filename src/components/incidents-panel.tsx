"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Clock3 } from "lucide-react";
import type { Plan } from "@/core/plans";
import type { IncidentReport } from "@/core/route-incidents";
import { api } from "./api";

const minuteText = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function IncidentsPanel({
  revision,
  timezone,
  initialPlanId,
}: {
  revision: number;
  timezone: string;
  initialPlanId?: string;
}) {
  const [catalog, setCatalog] = useState<{
    plans: Plan[];
    error: string;
    revision: number;
  }>();
  const [selected, setSelected] = useState(initialPlanId ?? "");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"forecast" | "actual">("forecast");
  const [snapshot, setSnapshot] = useState<{
    key: string;
    error: string;
    report?: IncidentReport;
  }>();
  useEffect(() => {
    let current = true;
    api<Plan[]>("/api/plans")
      .then((plans) => {
        if (current) setCatalog({ plans, error: "", revision });
      })
      .catch((e: Error) => {
        if (current) setCatalog({ plans: [], error: e.message, revision });
      });
    return () => {
      current = false;
    };
  }, [revision]);
  const planId = catalog?.plans.some((p) => p.id === selected)
    ? selected
    : (catalog?.plans[0]?.id ?? "");
  const key = `${planId}:${revision}`;
  useEffect(() => {
    if (!planId) return;
    let current = true;
    api<IncidentReport>(`/api/plans/${planId}/incidents`)
      .then((report) => {
        if (current) setSnapshot({ key, error: "", report });
      })
      .catch((e: Error) => {
        if (current) setSnapshot({ key, error: e.message });
      });
    return () => {
      current = false;
    };
  }, [planId, key]);
  const data = snapshot?.key === key ? snapshot : undefined;
  const forecast = data?.report;
  const query = search.trim().toLocaleLowerCase("es-MX");
  const visible =
    forecast?.rows.filter((row) =>
      [row.customer, ...row.orders]
        .join(" ")
        .toLocaleLowerCase("es-MX")
        .includes(query),
    ) ?? [];
  const catalogReady = catalog?.revision === revision;
  return (
    <section
      className="panel incidents-panel"
      aria-label="Incidencias de rutas"
    >
      <div className="panel-body stack">
        <div className="incident-filters">
          <label>
            Plan
            <select
              aria-label="Plan de incidencias"
              value={planId}
              onChange={(e) => setSelected(e.target.value)}
              disabled={!catalogReady || !catalog?.plans.length}
            >
              {!catalog?.plans.length && (
                <option value="">Sin planes disponibles</option>
              )}
              {catalog?.plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.label} · {plan.service_date}
                </option>
              ))}
            </select>
          </label>
          <label>
            Buscar cliente o pedido
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <div
          className="row incident-views"
          role="group"
          aria-label="Tipo de incidencia"
        >
          <button
            aria-pressed={view === "forecast"}
            onClick={() => setView("forecast")}
          >
            <AlertTriangle size={16} aria-hidden="true" />
            Retrasos previstos
          </button>
          <button
            aria-pressed={view === "actual"}
            onClick={() => setView("actual")}
          >
            <Clock3 size={16} aria-hidden="true" />
            Llegadas reales
          </button>
        </div>
        {view === "actual" ? (
          <div className="empty">
            <Clock3 size={28} aria-hidden="true" />
            <h2>Registro de llegadas pendiente</h2>
            <p>
              La APK del chofer aún no está conectada. Su botón «Llegué»
              registrará la llegada real y el inicio del surtido, no la entrega
              finalizada.
            </p>
            <p>Una llegada estimada no se registra como llegada real.</p>
          </div>
        ) : (
          <>
            <p className="notice">
              Previsión del recorrido, no entregas realizadas. Los retrasos no
              bloquean la ruta. Horarios en {timezone}.
            </p>
            {!catalogReady ? (
              <p role="status">Consultando planes…</p>
            ) : catalog.error ? (
              <p className="notice error" role="alert">
                {catalog.error} Usa Actualizar para reintentar.
              </p>
            ) : !planId ? (
              <p className="empty">Todavía no hay planes para consultar.</p>
            ) : !data ? (
              <p role="status">Consultando el cálculo guardado…</p>
            ) : data.error ? (
              <p className="notice error" role="alert">
                {data.error} Usa Actualizar para reintentar.
              </p>
            ) : forecast?.kind === "missing" ? (
              <p className="empty">
                Este plan todavía no tiene una ruta calculada.
              </p>
            ) : forecast?.kind === "stale" ? (
              <p className="notice" role="status">
                El plan cambió después del cálculo. No se muestran previsiones
                antiguas como si fueran vigentes. Actualiza cuando termine el
                recálculo.
              </p>
            ) : (
              forecast && (
                <>
                  {forecast.unmeasured > 0 && (
                    <p className="notice" role="status">
                      {forecast.unmeasured} destinos sin detalle de retraso
                      calculado. No se consideran puntuales ni tardíos.
                    </p>
                  )}
                  <p className="muted">
                    {forecast.rows.length} destinos con retraso previsto ·{" "}
                    {visible.length} visibles
                  </p>
                  {!visible.length && (
                    <p className="empty">
                      {query
                        ? "Ninguna incidencia coincide con la búsqueda."
                        : "No hay retrasos previstos en los destinos medidos."}
                    </p>
                  )}
                  <ul className="incident-list">
                    {visible.map((row) => (
                      <li className="incident-card" key={row.destinationId}>
                        <header>
                          <div>
                            <h2>{row.customer}</h2>
                            <span className="muted">
                              {row.orders.join(" · ")}
                            </span>
                          </div>
                          <span className="badge amber">
                            {new Intl.NumberFormat("es-MX", {
                              maximumFractionDigits: 1,
                            }).format(row.lateSeconds / 60)}{" "}
                            min de retraso previsto
                          </span>
                        </header>
                        <dl>
                          <div>
                            <dt>Camioneta / chofer</dt>
                            <dd>
                              {row.vehicle}
                              <small>
                                {row.driver || "Sin chofer asignado"}
                              </small>
                            </dd>
                          </div>
                          <div>
                            <dt>Ventana de recepción</dt>
                            <dd>
                              {row.windows
                                .map(
                                  (w) =>
                                    `${minuteText(w.startMinute)}–${minuteText(w.endMinute)}`,
                                )
                                .join(" / ") || "Sin horario"}
                            </dd>
                          </div>
                          <div>
                            <dt>Llegada estimada</dt>
                            <dd>
                              <time dateTime={row.eta}>
                                {new Date(row.eta).toLocaleString("es-MX", {
                                  timeZone: timezone,
                                  dateStyle: "short",
                                  timeStyle: "short",
                                  hour12: false,
                                })}
                              </time>
                            </dd>
                          </div>
                        </dl>
                      </li>
                    ))}
                  </ul>
                </>
              )
            )}
          </>
        )}
      </div>
    </section>
  );
}
