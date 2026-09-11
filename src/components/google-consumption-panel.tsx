"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CloudCog,
  Database,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import type {
  GoogleConsumptionLevel,
  GoogleConsumptionSnapshot,
  GoogleConsumptionState,
} from "@/core/google-consumption-contract";
import { api } from "./api";

const levelText: Record<GoogleConsumptionLevel, string> = {
  healthy: "Dentro de cuota",
  attention: "Atención",
  warning: "Cerca del límite",
  critical: "Límite crítico",
  charging: "Con cargo real",
  unpriced: "Sin umbral publicado",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: value < 10 ? 3 : 1,
  }).format(value);
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${formatNumber(value)} ${currency}`;
  }
}

function formatInstant(value: string | null, timezone: string) {
  if (!value) return "Aún sin corte publicado";
  return new Date(value).toLocaleString("es-MX", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function MonthlyChart({ snapshot }: { snapshot: GoogleConsumptionSnapshot }) {
  const months = snapshot.months.slice(-3);
  const maximum = Math.max(0.01, ...months.map((month) => month.grossCost));
  if (!months.length)
    return (
      <div className="consumption-chart-empty">
        Google todavía no publicó historial para este proyecto.
      </div>
    );
  if (months.every((month) => month.grossCost === 0 && month.netCost === 0))
    return (
      <div className="consumption-chart-empty">
        Google reporta costo cero en los periodos publicados.
      </div>
    );
  return (
    <div
      className="consumption-chart"
      role="img"
      aria-label="Costo bruto y costo neto de los últimos tres meses"
    >
      {months.map((month) => {
        const gross = Math.max(2, (month.grossCost / maximum) * 100);
        const net = Math.max(0, (month.netCost / maximum) * 100);
        return (
          <div className="consumption-chart-column" key={month.periodStart}>
            <div className="consumption-chart-bars" aria-hidden="true">
              <span className="gross" style={{ height: `${gross}%` }} />
              <span className="net" style={{ height: `${net}%` }} />
            </div>
            <strong>
              {new Date(`${month.periodStart}T12:00:00Z`).toLocaleDateString(
                "es-MX",
                { month: "short" },
              )}
            </strong>
            <small>{formatMoney(month.netCost, snapshot.currency)}</small>
          </div>
        );
      })}
    </div>
  );
}

function DailyChart({ snapshot }: { snapshot: GoogleConsumptionSnapshot }) {
  const days = snapshot.days.filter((day) =>
    day.date.startsWith(snapshot.currentPeriod.slice(0, 7)),
  );
  if (!days.length)
    return (
      <div className="consumption-chart-empty">
        Google todavía no publicó días para el mes vigente.
      </div>
    );
  if (days.every((day) => day.grossCost === 0 && day.netCost === 0))
    return (
      <div className="consumption-chart-empty">
        Google reporta costo diario cero en el mes vigente.
      </div>
    );
  const maximum = Math.max(...days.map((day) => day.netCost), 0.01);
  const points = days
    .map((day, index) => {
      const x = days.length === 1 ? 360 : (index / (days.length - 1)) * 720;
      const y = 140 - (Math.max(0, day.netCost) / maximum) * 120;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <div className="consumption-daily-chart">
      <svg
        viewBox="0 0 720 160"
        role="img"
        aria-label="Costo neto diario del mes vigente"
        preserveAspectRatio="none"
      >
        <line x1="0" y1="140" x2="720" y2="140" />
        <polyline points={points} />
      </svg>
      <div aria-hidden="true">
        <span>{days[0].date.slice(8, 10)}</span>
        <strong>{formatMoney(maximum, snapshot.currency)} máximo</strong>
        <span>{days.at(-1)!.date.slice(8, 10)}</span>
      </div>
      <ul className="sr-only">
        {days.map((day) => (
          <li key={day.date}>
            {day.date}: {formatMoney(day.netCost, snapshot.currency)} netos
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadyPanel({
  state,
  timezone,
}: {
  state: GoogleConsumptionState;
  timezone: string;
}) {
  const snapshot = state.snapshot!;
  const percentage = Math.max(
    0,
    Math.min(100, snapshot.maximumPercentage ?? 0),
  );
  const gaugeLevel = snapshot.skus.some((sku) => sku.level === "charging")
    ? "charging"
    : percentage >= 95
      ? "critical"
      : percentage >= 85
        ? "warning"
        : percentage >= 70
          ? "attention"
          : "healthy";
  return (
    <>
      {state.status === "stale" && (
        <div className="consumption-stale" role="status">
          <AlertTriangle size={17} />
          Google no respondió en el último intento. Conservamos el último corte
          oficial, sin inventar movimientos.
        </div>
      )}
      <div className="consumption-overview">
        <article className="consumption-hero panel">
          <div>
            <span className="eyebrow">Costo neto del mes</span>
            <strong>{formatMoney(snapshot.netCost, snapshot.currency)}</strong>
            <p>
              Bruto {formatMoney(snapshot.grossCost, snapshot.currency)} ·
              Créditos {formatMoney(snapshot.credits, snapshot.currency)}
            </p>
          </div>
          <div
            className={`consumption-gauge ${gaugeLevel}`}
            role="img"
            aria-label={`Mayor consumo de cuota: ${formatNumber(snapshot.maximumPercentage ?? 0)} por ciento`}
          >
            <svg viewBox="0 0 120 72" aria-hidden="true">
              <path d="M14 62a46 46 0 0 1 92 0" pathLength="100" />
              <path
                className="value"
                d="M14 62a46 46 0 0 1 92 0"
                pathLength="100"
                style={{ strokeDasharray: `${percentage} 100` }}
              />
            </svg>
            <strong>{formatNumber(snapshot.maximumPercentage ?? 0)}%</strong>
            <small>máximo de cuota</small>
          </div>
        </article>
        <article className="consumption-source panel">
          <div className="consumption-source-title">
            <CheckCircle2 size={18} />
            <div>
              <strong>Google Cloud Billing oficial</strong>
              <small>Standard usage + Pricing Export</small>
            </div>
          </div>
          <dl>
            <div>
              <dt>Proyecto medido</dt>
              <dd>{snapshot.mapsProjectId}</dd>
            </div>
            <div>
              <dt>Último corte de Google</dt>
              <dd>{formatInstant(snapshot.providerExportTime, timezone)}</dd>
            </div>
            <div>
              <dt>Precios vigentes al</dt>
              <dd>{formatInstant(snapshot.pricingAsOfTime, timezone)}</dd>
            </div>
          </dl>
        </article>
      </div>

      <section className="consumption-section" aria-labelledby="sku-title">
        <div className="consumption-section-heading">
          <div>
            <span className="eyebrow">Periodo {snapshot.currentPeriod}</span>
            <h2 id="sku-title">Cuotas y cargos por servicio</h2>
          </div>
          <span className="badge">{snapshot.skus.length} SKU usados</span>
        </div>
        {snapshot.skus.length ? (
          <div className="consumption-skus">
            {snapshot.skus.map((sku) => {
              const progress = Math.max(0, Math.min(100, sku.percentage ?? 0));
              return (
                <article className="consumption-sku" key={sku.skuId}>
                  <header>
                    <div>
                      <strong>{sku.skuName}</strong>
                      <small>{sku.serviceName}</small>
                    </div>
                    <span className={`consumption-level ${sku.level}`}>
                      {levelText[sku.level]}
                    </span>
                  </header>
                  <div className="consumption-progress-line">
                    <span
                      className={`consumption-progress ${sku.level}`}
                      role="progressbar"
                      aria-label={`Uso de ${sku.skuName}`}
                      aria-valuemin={0}
                      aria-valuemax={
                        sku.freeLimit === null
                          ? undefined
                          : Math.max(sku.freeLimit, sku.usage)
                      }
                      aria-valuenow={sku.usage}
                      aria-valuetext={
                        sku.percentage === null
                          ? `${formatNumber(sku.usage)} ${sku.pricingUnit}`
                          : `${formatNumber(sku.percentage)} por ciento de la cuota sin cargo`
                      }
                    >
                      <span style={{ width: `${progress}%` }} />
                    </span>
                    <strong>
                      {sku.percentage === null
                        ? "—"
                        : `${formatNumber(sku.percentage)}%`}
                    </strong>
                  </div>
                  <dl>
                    <div>
                      <dt>Uso real</dt>
                      <dd>
                        {formatNumber(sku.usage)} {sku.pricingUnit}
                      </dd>
                    </div>
                    <div>
                      <dt>Cuota sin cargo</dt>
                      <dd>
                        {sku.freeLimit === null
                          ? "No publicada"
                          : formatNumber(sku.freeLimit)}
                      </dd>
                    </div>
                    <div>
                      <dt>Restante</dt>
                      <dd>
                        {sku.remaining === null
                          ? "No calculable"
                          : formatNumber(sku.remaining)}
                      </dd>
                    </div>
                    <div>
                      <dt>Costo neto</dt>
                      <dd>{formatMoney(sku.netCost, snapshot.currency)}</dd>
                    </div>
                  </dl>
                  {sku.nextTierPrice !== null &&
                    sku.nextTierQuantity !== null && (
                      <p className="consumption-price-note">
                        Siguiente tramo oficial:{" "}
                        {formatMoney(sku.nextTierPrice, snapshot.currency)} por{" "}
                        {formatNumber(sku.nextTierQuantity)} {sku.pricingUnit}.
                      </p>
                    )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="consumption-chart-empty">
            El corte existe, pero Google aún no publicó SKUs usados este mes.
          </div>
        )}
      </section>

      <section className="consumption-section" aria-labelledby="history-title">
        <div className="consumption-section-heading">
          <div>
            <span className="eyebrow">Acumulación real</span>
            <h2 id="history-title">Historial de costo oficial</h2>
          </div>
        </div>
        <div className="consumption-history-grid">
          <article>
            <h3>Costo diario del mes</h3>
            <DailyChart snapshot={snapshot} />
          </article>
          <article>
            <header>
              <h3>Últimos tres meses</h3>
              <div className="consumption-chart-legend">
                <span className="gross">Bruto</span>
                <span className="net">Neto</span>
              </div>
            </header>
            <MonthlyChart snapshot={snapshot} />
          </article>
        </div>
      </section>
    </>
  );
}

export function GoogleConsumptionPanel({
  revision,
  timezone,
}: {
  revision: number;
  timezone: string;
}) {
  const [state, setState] = useState<GoogleConsumptionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    const load = () =>
      api<GoogleConsumptionState>("/api/google-consumption")
        .then((value) => {
          if (current) {
            setState(value);
            setError("");
          }
        })
        .catch((reason: Error) => {
          if (current) setError(reason.message);
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [revision]);

  const headerStatus = useMemo(() => {
    if (!state?.configured) return "Configuración pendiente";
    if (state.status === "syncing") return "Consultando Google";
    if (state.status === "stale") return "Último corte conservado";
    if (state.status === "ready") return "Datos oficiales";
    return "Esperando exportación";
  }, [state]);

  async function synchronize() {
    setSyncing(true);
    setError("");
    try {
      setState(
        await api<GoogleConsumptionState>("/api/google-consumption", "POST"),
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="consumption-panel" aria-busy={loading || syncing}>
      <header className="consumption-command-bar">
        <div>
          <span className="eyebrow">Gobernanza FinOps</span>
          <strong>{headerStatus}</strong>
        </div>
        <button
          className="quiet"
          onClick={() => void synchronize()}
          disabled={loading || syncing || state?.configured === false}
        >
          <RefreshCw className={syncing ? "spin" : ""} size={16} />
          {syncing ? "Sincronizando…" : "Sincronizar ahora"}
        </button>
      </header>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {loading && !state && (
        <div className="empty">
          <RefreshCw className="spin" />
          <h3>Leyendo el último corte oficial</h3>
        </div>
      )}
      {state?.status === "unconfigured" && (
        <div className="consumption-setup panel">
          <CloudCog size={34} />
          <div>
            <span className="eyebrow">Integración pendiente</span>
            <h2>Conecta Cloud Billing con BigQuery</h2>
            <p>
              Ana Rutas no mostrará estimaciones. Para ver consumo y costo real,
              habilita las exportaciones Standard y Pricing de Google y agrega
              la cuenta FinOps privada en EasyPanel.
            </p>
          </div>
          <ol>
            <li>
              <Database size={17} />
              Exportaciones Standard usage cost y Pricing data al mismo dataset.
            </li>
            <li>
              <ShieldCheck size={17} />
              Cuenta de servicio con Job User y Data Viewer limitado al dataset.
            </li>
            <li>
              <Clock3 size={17} />
              Variables privadas configuradas y servicio reiniciado.
            </li>
          </ol>
        </div>
      )}
      {state?.configured && !state.snapshot && (
        <>
          {state.errorCode && (
            <p className="notice error" role="status">
              Google no pudo completar la última sincronización. Revisa la
              exportación y permisos; no se mostrará un costo estimado.
            </p>
          )}
          <div className="consumption-setup panel">
            <TrendingUp size={34} />
            <div>
              <span className="eyebrow">Sin fotografía disponible</span>
              <h2>
                {state.status === "syncing"
                  ? "Google está procesando la consulta"
                  : "Esperando el primer corte exportado"}
              </h2>
              <p>
                Cloud Billing puede publicar datos con retraso. La pantalla se
                completará automáticamente cuando Google entregue el corte real.
              </p>
            </div>
          </div>
        </>
      )}
      {state?.snapshot && <ReadyPanel state={state} timezone={timezone} />}
    </section>
  );
}
