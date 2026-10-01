"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, ArrowLeft, Wallet, Check, X } from "lucide-react";
import { api } from "./api";
import { usePanelRealtime } from "./use-panel-realtime";
import type {
  readSettlementDetail,
  listSettlements,
} from "@/core/finance-read";
import type { paymentTotals } from "@/core/payment-policy";
import {
  productIncidentNames,
  type ProductIncidentKind,
} from "@/core/product-incidents-policy";
type Detail = Awaited<ReturnType<typeof readSettlementDetail>>;
type Report = Awaited<ReturnType<typeof listSettlements>>;
type Total = ReturnType<typeof paymentTotals>[number];
const methodName = {
  cash: "Efectivo",
  transfer: "Transferencia",
  credit: "Crédito",
  mixed: "Efectivo + transferencia",
};
const stateName = {
  pending: "Por recibir",
  accepted: "Aceptada",
  rejected: "Rechazada",
};
function MoneySummary({ totals, title }: { totals: Total[]; title: string }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
      </div>
      <div className="panel-body stack">
        {!totals.length && <p className="muted">Sin importes registrados.</p>}
        {totals.map((t) => (
          <div
            key={`${t.currency.id}:${t.currency.name}`}
            className="settlement-money"
          >
            <strong>{t.currency.name}</strong>
            <span className="cash">
              Efectivo <b>{t.cash}</b>
            </span>
            <span className="transfer">
              Transferencias <b>{t.transfer}</b>
            </span>
            <span className="credit">
              Créditos <b>{t.credit}</b>
            </span>
            <small>
              Saldo de cobros parciales: {t.balance} · Reposiciones diferidas:{" "}
              {t.deferred}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}
export function SettlementPanel({ today }: { today: string }) {
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [dateBasis, setDateBasis] = useState("route"),
    [page, setPage] = useState(0),
    [report, setReport] = useState<Report | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{
      request: Detail["requests"][number];
      decision: "accepted" | "rejected";
      commandId: string;
      submittedNote?: string;
    } | null>(null),
    [note, setNote] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const [nextReport, nextDetail] = await Promise.all([
        api<Report>(
          `/api/settlements?from=${from}&to=${to}&page=${page}&dateBasis=${dateBasis}`,
        ),
        selected
          ? api<Detail>(`/api/settlements/${selected}`)
          : Promise.resolve(null),
      ]);
      if (current !== generation.current) return true;
      setReport(nextReport);
      setDetail(nextDetail);
      setError("");
      return true;
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
      return false;
    }
  }, [from, to, page, selected, dateBasis]);
  useEffect(() => {
    const requests = generation;
    const timer = setTimeout(() => void refresh(), 0);
    return () => {
      clearTimeout(timer);
      requests.current++;
    };
  }, [refresh]);
  usePanelRealtime(refresh, busy);
  async function decide() {
    if (!confirmation) return;
    const submittedNote = confirmation.submittedNote ?? note;
    setConfirmation({ ...confirmation, submittedNote });
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/settlements/requests/${confirmation.request.id}`,
        "POST",
        {
          commandId: confirmation.commandId,
          version: confirmation.request.version,
          basis: confirmation.request.basis,
          decision: confirmation.decision,
          note: submittedNote,
        },
      );
      setConfirmation(null);
      setNote("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack settlement-panel">
      <div className="toolbar">
        <label>
          Consultar por
          <select
            value={dateBasis}
            disabled={busy}
            onChange={(e) => {
              setDateBasis(e.target.value);
              setPage(0);
              setSelected(null);
              setDetail(null);
            }}
          >
            <option value="route">Fecha de ruta</option>
            <option value="receipt">Fecha de recepción</option>
          </select>
        </label>
        <label>
          Desde
          <input
            type="date"
            value={from}
            disabled={busy}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={to}
            disabled={busy}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <button onClick={() => void refresh()} disabled={busy}>
          <RefreshCw size={16} />
          Actualizar
        </button>
      </div>
      <p className="muted">
        {dateBasis === "route"
          ? "Fechas de ruta. Los cobros declarados y las recepciones aceptadas se muestran por separado."
          : "Recepciones aceptadas en estas fechas, según la zona horaria de la operación. Puede incluir rutas de días anteriores."}
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="grid-three">
        {(
          [
            ["collected", "Cobrado por choferes"],
            ["pending", "Solicitado por recibir"],
            ["accepted", "Aceptado por liquidación"],
          ] as const
        )
          .filter(([stage]) => dateBasis === "route" || stage === "accepted")
          .map(([stage, title]) => (
            <MoneySummary
              key={stage}
              title={title}
              totals={report?.metrics.filter((m) => m.stage === stage) ?? []}
            />
          ))}
      </div>
      {selected && (
        <button
          onClick={() => {
            setSelected(null);
            setDetail(null);
          }}
        >
          <ArrowLeft size={16} />
          Volver a choferes
        </button>
      )}
      {!selected && report && (
        <>
          {!report.rows.length && (
            <div className="empty">
              No hay pedidos cobrados en estas fechas.
            </div>
          )}
          {[...new Set(report.rows.map((r) => r.driverId as string))].map(
            (driverId) => (
              <section className="panel" key={driverId}>
                <div className="panel-header">
                  <h2>
                    {report.rows.find((r) => r.driverId === driverId)!.driver}
                  </h2>
                </div>
                <div className="panel-body stack">
                  {report.rows
                    .filter((r) => r.driverId === driverId)
                    .map((r) => (
                      <button
                        className="settlement-route"
                        key={r.id}
                        onClick={() => setSelected(r.id)}
                      >
                        <Wallet size={20} />
                        <span>
                          <strong>
                            {r.label} · {r.date}
                          </strong>
                          <small>
                            {r.vehicle} · {r.payments}/{r.delivered} cobros
                            registrados
                          </small>
                        </span>
                        <span className="badge">{r.pending} por recibir</span>
                      </button>
                    ))}
                </div>
              </section>
            ),
          )}
          <div className="toolbar">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </button>
            <span>Página {page + 1}</span>
            <button
              disabled={!report.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </button>
          </div>
        </>
      )}
      {selected && !detail && <p role="status">Cargando liquidación…</p>}
      {detail && (
        <>
          <h2>
            {detail.route.driver} · {detail.route.label} · {detail.route.date}
          </h2>
          <div className="grid-two">
            <MoneySummary
              title="Pendiente de entregar"
              totals={detail.outstandingTotals}
            />
            <MoneySummary title="Ya aceptado" totals={detail.acceptedTotals} />
          </div>
          <section className="panel">
            <div className="panel-header">
              <h2>Solicitudes del chofer</h2>
            </div>
            <div className="panel-body stack">
              {!detail.requests.length && (
                <p className="muted">El chofer aún no solicita liquidación.</p>
              )}
              {detail.requests.map((r) => (
                <div className="settlement-request" key={r.id}>
                  <strong>
                    {r.scope === "route" ? "Toda la ruta" : "Por pedido"} ·{" "}
                    {stateName[r.status]}
                  </strong>
                  <small>
                    {new Date(r.requestedAt).toLocaleString()} ·{" "}
                    {r.paymentIds.length} pedidos
                  </small>
                  <p>
                    {detail.orders
                      .filter(
                        (o) => o.payment && r.paymentIds.includes(o.payment.id),
                      )
                      .map((o) => `${o.orderName} · ${o.customer}`)
                      .join(" / ")}
                  </p>
                  <MoneySummary
                    title="Importes de esta solicitud"
                    totals={r.totals}
                  />
                  {r.status === "pending" && r.scope === "route" ? (
                    <div className="toolbar">
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => {
                          setNote("");
                          setConfirmation({
                            request: r,
                            decision: "accepted",
                            commandId: crypto.randomUUID(),
                          });
                        }}
                      >
                        <Check size={16} />
                        Aceptar
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setNote("");
                          setConfirmation({
                            request: r,
                            decision: "rejected",
                            commandId: crypto.randomUUID(),
                          });
                        }}
                      >
                        <X size={16} />
                        Rechazar
                      </button>
                    </div>
                  ) : r.status === "pending" ? (
                    <p className="muted">
                      Acepta este importe desde la tarjeta del cliente.
                    </p>
                  ) : (
                    <p>
                      {r.receiver} ·{" "}
                      {r.decidedAt && new Date(r.decidedAt).toLocaleString()}{" "}
                      {r.note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
          {detail.orders.map((o) => {
            const payment = o.payment;
            const pending =
              payment &&
              detail.requests.find(
                (r) =>
                  r.scope === "order" &&
                  r.status === "pending" &&
                  r.paymentIds.includes(payment.id),
              );
            const accepted =
              payment &&
              detail.requests.find(
                (r) =>
                  r.status === "accepted" && r.paymentIds.includes(payment.id),
              );
            const frozen = payment?.snapshot.financial ?? o.financial;
            return (
              <section className="panel settlement-order" key={o.shipmentId}>
                <div className="settlement-order-receipt">
                  <div className="settlement-order-amount">
                    <small>
                      {accepted ? "Recibido" : "Monto a entregar"} ·{" "}
                      {payment && methodName[payment.method]}
                    </small>
                    <strong>
                      {payment?.method === "credit"
                        ? payment.expected
                        : payment?.received}{" "}
                      {payment?.currency.name}
                    </strong>
                    {payment?.method === "mixed" && (
                      <span>
                        💵 Efectivo {payment.cashReceived} · 🏦 Transferencia{" "}
                        {payment.transferReceived}
                      </span>
                    )}
                  </div>
                  <button
                    className="primary"
                    disabled={busy || !pending || !!accepted}
                    onClick={() => {
                      if (!pending) return;
                      setNote("");
                      setConfirmation({
                        request: pending,
                        decision: "accepted",
                        commandId: crypto.randomUUID(),
                      });
                    }}
                  >
                    <Check size={16} />
                    {accepted ? "Recibido" : "Aceptar"}
                  </button>
                  {!pending && !accepted && (
                    <small className="muted">
                      Esperando que el chofer pulse Liquidar.
                    </small>
                  )}
                </div>
                <details>
                  <summary className="panel-header">
                    <strong>
                      {o.customer} · {o.orderName}
                    </strong>
                    <span>
                      {o.payment
                        ? `${methodName[o.payment.method]} · ${o.payment.method === "credit" ? o.payment.expected : o.payment.received} ${o.payment.currency.name}`
                        : "Sin cobro registrado"}
                    </span>
                  </summary>
                  <div className="panel-body stack">
                    {o.payment && (
                      <>
                        {o.payment.captureVersion === 1 && (
                          <p>
                            Recibido: {o.payment.received} · Cambio:{" "}
                            {o.payment.change} · Saldo: {o.payment.balance}{" "}
                            {o.payment.currency.name}
                          </p>
                        )}
                        <p>{o.payment.note || "Sin notas del chofer"}</p>
                        <small>
                          Confirmado{" "}
                          {new Date(o.payment.recordedAt).toLocaleString()}
                        </small>
                      </>
                    )}
                    {o.changedAfterPayment && (
                      <p className="notice">
                        La fuente cambió después del cobro. Se conserva el
                        detalle confirmado que aparece a continuación.
                      </p>
                    )}
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Producto</th>
                            <th>Cantidad</th>
                            <th>Unitario</th>
                            <th>Original</th>
                            <th>A cobrar</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            o.payment?.snapshot.financial ?? o.financial
                          )?.lines.map((line) => (
                            <tr key={line.moveId}>
                              <td>
                                {
                                  (o.payment?.snapshot.order ?? o.order)?.lines[
                                    line.lineIndex
                                  ]?.name
                                }
                              </td>
                              <td>
                                {line.quantity} {line.unit}
                              </td>
                              <td>{line.unitPrice}</td>
                              <td>{line.total}</td>
                              <td>{line.net ?? "Por revisar"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {frozen?.totals && (
                      <div className="settlement-order-totals">
                        <span>
                          Importe original{" "}
                          <b>
                            {frozen.totals.original} {frozen.currency?.name}
                          </b>
                        </span>
                        <span>
                          Devoluciones y faltantes{" "}
                          <b>
                            − {frozen.totals.deduction} {frozen.currency?.name}
                          </b>
                        </span>
                        <strong>
                          Total {frozen.totals.net} {frozen.currency?.name}
                        </strong>
                      </div>
                    )}
                    <h3>Incidencias al confirmar</h3>
                    {(o.payment?.snapshot.incidents ?? o.incidents).map((i) => (
                      <div key={i.id}>
                        <strong>
                          {i.product} · {i.quantity} {i.unit}
                        </strong>
                        <p>
                          {productIncidentNames[
                            i.kind as ProductIncidentKind
                          ] ?? i.kind}{" "}
                          ·{" "}
                          {{
                            open: "Abierta",
                            pending: "Pendiente",
                            resolved: "Resuelta",
                            canceled: "Cancelada",
                          }[i.status as string] ?? i.status}{" "}
                          · {i.note}
                        </p>
                        {i.replacement_payment && (
                          <p>
                            {i.replacement_payment === "pay_full"
                              ? "Reposición: cliente paga completo"
                              : "Reposición: se pagará al entregar"}
                          </p>
                        )}
                        <div className="toolbar">
                          {[...new Set([i.evidence_id, ...i.evidence_ids])]
                            .filter(Boolean)
                            .map((photo, index) => (
                              <a
                                target="_blank"
                                rel="noreferrer"
                                key={photo}
                                href={`/api/settlements/${detail.route.id}/evidence?incidentId=${i.id}&photoId=${photo}`}
                              >
                                Foto {index + 1}
                              </a>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </section>
            );
          })}
        </>
      )}
      {confirmation && (
        <dialog
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          className="fleet-dialog settlement-dialog"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) setConfirmation(null);
          }}
          aria-labelledby="settlement-confirm-title"
        >
          <div className="modal-header">
            <h2 id="settlement-confirm-title">
              {confirmation.decision === "accepted"
                ? "Confirmar recepción"
                : "Rechazar solicitud"}
            </h2>
          </div>
          <div className="modal-body stack">
            <strong>
              {detail?.orders
                .filter(
                  (o) =>
                    o.payment &&
                    confirmation.request.paymentIds.includes(o.payment.id),
                )
                .map((o) => `${o.customer} · ${o.orderName}`)
                .join(" · ")}
            </strong>
            <p>
              {confirmation.decision === "accepted"
                ? `Estás recibiendo la liquidación de ${detail?.route.driver} para ${confirmation.request.scope === "order" ? "este cliente" : "estos clientes"}. Confirma los importes y medios de pago indicados.`
                : "La solicitud quedará en el historial y el chofer podrá enviarla de nuevo."}
            </p>
            {confirmation.decision === "accepted" &&
              detail?.orders
                .filter(
                  (o) =>
                    o.payment &&
                    confirmation.request.paymentIds.includes(o.payment.id),
                )
                .map((o) => (
                  <p className="settlement-order-amount" key={o.shipmentId}>
                    <strong>
                      {o.payment!.method === "credit"
                        ? o.payment!.expected
                        : o.payment!.received}{" "}
                      {o.payment!.currency.name}
                    </strong>
                    <span>
                      {methodName[o.payment!.method]} · {o.customer}
                    </span>
                  </p>
                ))}
            <MoneySummary
              title="Importes exactos"
              totals={confirmation.request.totals}
            />
            <label>
              Nota
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                disabled={busy || confirmation.submittedNote !== undefined}
              />
            </label>
            {error && <p role="alert">{error}</p>}
          </div>
          <div className="modal-footer">
            <button disabled={busy} onClick={() => setConfirmation(null)}>
              Cancelar
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void decide()}
            >
              {busy
                ? "Guardando…"
                : confirmation.decision === "accepted"
                  ? "Aceptar"
                  : "Confirmar rechazo"}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
