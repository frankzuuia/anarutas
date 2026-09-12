"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CandidateBatch,
  CandidateSelection,
} from "@/core/order-candidates-contract";

export function OrderCandidatePicker({
  batch,
  timezone,
  busy,
  onBack,
  onClose,
  onConfirm,
}: {
  batch: CandidateBatch;
  timezone: string;
  busy: boolean;
  onBack: () => void;
  onClose: () => void;
  onConfirm: (selection: CandidateSelection) => Promise<void>;
}) {
  const [selection, setSelection] = useState<CandidateSelection>({
    mode: "explicit",
    ids: [],
  });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const all = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const ids = new Set(selection.ids);
  const count =
    selection.mode === "explicit" ? ids.size : batch.total - ids.size;
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (all.current)
      all.current.indeterminate = count > 0 && count < batch.total;
  }, [count, batch.total]);
  const shown = batch.candidates.filter(
    (c) =>
      (filter === "all" || c.shipment.fulfillmentStatus === filter) &&
      `${c.shipment.orderName} ${c.shipment.customerName}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase().trim()),
  );
  const visible = shown.slice(page * 50, (page + 1) * 50);
  const mixed = count > 0 && count < batch.total;
  async function confirm() {
    if (inFlight.current || !count) return;
    inFlight.current = true;
    setError("");
    try {
      await onConfirm(selection);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <div className="candidate-picker">
      <div className="candidate-overview">
        <h3 ref={heading} tabIndex={-1}>
          Seleccionar pedidos · {batch.date}
        </h3>
        <p className="muted">
          {batch.total} {batch.total === 1 ? "pedido" : "pedidos"} ·{" "}
          {batch.validated} {batch.validated === 1 ? "validado" : "validados"} ·{" "}
          {batch.pending} {batch.pending === 1 ? "pendiente" : "pendientes"} ·{" "}
          {batch.existing} ya cargados
        </p>
      </div>
      {error && (
        <p id="candidate-error" role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="candidate-filters">
        <label>
          Buscar folio o cliente
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            disabled={busy}
          />
        </label>
        <label>
          Estado
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
            disabled={busy}
          >
            <option value="all">Todos</option>
            <option value="validated">Validados</option>
            <option value="pending_validation">Pendientes</option>
          </select>
        </label>
      </div>
      <label className="candidate-select-all">
        <input
          ref={all}
          type="checkbox"
          checked={batch.total > 0 && count === batch.total}
          aria-checked={
            mixed ? "mixed" : batch.total > 0 && count === batch.total
          }
          disabled={busy || !batch.total}
          onChange={(e) =>
            setSelection({
              mode: e.target.checked ? "all_except" : "explicit",
              ids: [],
            })
          }
        />
        Seleccionar todos los {batch.total} pedidos
      </label>
      <p role="status" className="muted">
        {count} seleccionados · {shown.length} coinciden con el filtro
      </p>
      <div className="candidate-list">
        {visible.map((c) => {
          const s = c.shipment,
            date =
              s.fulfillmentStatus === "validated"
                ? s.validatedAt
                : s.scheduledAt;
          return (
            <article className="candidate-row" key={c.candidateId}>
              <label className="candidate-choice">
                <input
                  type="checkbox"
                  aria-label={`Seleccionar ${s.orderName} ${s.pickingName}`}
                  disabled={busy}
                  checked={
                    selection.mode === "explicit"
                      ? ids.has(c.candidateId)
                      : !ids.has(c.candidateId)
                  }
                  onChange={() =>
                    setSelection((old) => ({
                      ...old,
                      ids: old.ids.includes(c.candidateId)
                        ? old.ids.filter((id) => id !== c.candidateId)
                        : [...old.ids, c.candidateId],
                    }))
                  }
                />
                <span>
                  <strong>
                    {s.orderName} · {s.customerName}
                  </strong>
                  <small>
                    {s.pickingName} · {s.lines.length} partidas
                  </small>
                </span>
              </label>
              <div className="candidate-info">
                <span className="badge">
                  {s.fulfillmentStatus === "validated"
                    ? "Validado"
                    : "Pendiente de validar"}
                </span>
                {c.alreadyLoaded && (
                  <span className="badge">Ya está en este plan</span>
                )}
                <small>
                  {date &&
                    new Date(date).toLocaleString("es-MX", {
                      timeZone: timezone,
                    })}
                </small>
                <p className="muted">
                  {s.address || "Dirección pendiente"} ·{" "}
                  {c.hasCoordinates ? "Punto confirmado" : "Punto pendiente"}
                </p>
                <details>
                  <summary>
                    Ver {s.lines.length}{" "}
                    {s.lines.length === 1 ? "partida" : "partidas"}
                  </summary>
                  <ul>
                    {s.lines.map((l) => (
                      <li key={l.moveId}>
                        {l.name} · {l.quantity} {l.unit}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </article>
          );
        })}
        {!shown.length && (
          <p className="muted">
            No hay pedidos para mostrar con esta fecha y filtro.
          </p>
        )}
      </div>
      {shown.length > 50 && (
        <nav className="order-actions" aria-label="Páginas de candidatos">
          <button
            className="quiet"
            disabled={page === 0 || busy}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span>
            Página {page + 1} de {Math.ceil(shown.length / 50)}
          </span>
          <button
            className="quiet"
            disabled={(page + 1) * 50 >= shown.length || busy}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </button>
        </nav>
      )}
      <footer className="candidate-actions">
        <button className="quiet" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button className="quiet" disabled={busy} onClick={onBack}>
          Volver
        </button>
        <button
          className="primary"
          aria-describedby={error ? "candidate-error" : undefined}
          disabled={busy || !count}
          onClick={() => void confirm()}
        >
          {busy ? "Guardando…" : `Guardar pedidos (${count})`}
        </button>
      </footer>
    </div>
  );
}
