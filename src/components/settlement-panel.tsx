"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, ArrowLeft, Wallet, Check, X } from "lucide-react";
import { api } from "./api";
import { usePanelRealtime } from "./use-panel-realtime";
import type {
  readSettlementDetail,
  listSettlements,
} from "@/core/finance-read";
import { displayMoney as money } from "@/core/financial-display";
import {
  MoneySummary,
  SettlementOrderModal,
  methodName,
  settlementOrderStatus,
} from "./settlement-presentation";
type Detail = Awaited<ReturnType<typeof readSettlementDetail>>;
type Report = Awaited<ReturnType<typeof listSettlements>>;
const stateName = {
  pending: "Por recibir",
  accepted: "Recibida",
  rejected: "Rechazada",
};
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
  const [openedOrder, setOpenedOrder] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [orderStatus, setOrderStatus] = useState("all");
  const [orderPage, setOrderPage] = useState(0);
  const [summaryStage, setSummaryStage] = useState("collected");
  const filteredOrders = (detail?.orders ?? []).filter(
    (order) =>
      (orderStatus === "all" || order.settlementStatus === orderStatus) &&
      (order.customer + " " + order.orderName)
        .toLocaleLowerCase("es-MX")
        .includes(search.trim().toLocaleLowerCase("es-MX")),
  );
  const lastOrderPage = Math.max(0, Math.ceil(filteredOrders.length / 12) - 1);
  const visiblePage = Math.min(orderPage, lastOrderPage);
  const selectedOrder = detail?.orders.find(
    (order) => order.shipmentId === openedOrder,
  );
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
      {!selected && (
        <>
          <div
            className="settlement-stages"
            aria-label="Estado de los importes"
          >
            {(
              [
                ["collected", "Cobrado por choferes"],
                ["pending", "Por recibir"],
                ["accepted", "Recibido por liquidación"],
              ] as const
            )
              .filter(
                ([stage]) => dateBasis === "route" || stage === "accepted",
              )
              .map(([stage, label]) => (
                <button
                  key={stage}
                  aria-pressed={
                    (dateBasis === "receipt" ? "accepted" : summaryStage) ===
                    stage
                  }
                  onClick={() => setSummaryStage(stage)}
                >
                  {label}
                </button>
              ))}
          </div>
          <MoneySummary
            title={
              dateBasis === "receipt" || summaryStage === "accepted"
                ? "Recibido por liquidación"
                : summaryStage === "pending"
                  ? "Solicitado por recibir"
                  : "Cobrado por choferes"
            }
            totals={
              report?.metrics.filter(
                (metric) =>
                  metric.stage ===
                  (dateBasis === "receipt" ? "accepted" : summaryStage),
              ) ?? []
            }
          />
        </>
      )}
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
                <div className="panel-body settlement-routes">
                  {report.rows
                    .filter((r) => r.driverId === driverId)
                    .map((r) => (
                      <button
                        className="settlement-route"
                        key={r.id}
                        onClick={() => {
                          setSelected(r.id);
                          setSearch("");
                          setOrderStatus("all");
                          setOrderPage(0);
                          setOpenedOrder(null);
                        }}
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
          <div className="stack">
            <MoneySummary
              title="Por entregar a liquidación"
              totals={detail.outstandingTotals}
            />
            <MoneySummary
              title="Recibido por liquidación"
              totals={detail.acceptedTotals}
            />
          </div>
          <div className="toolbar settlement-order-filters">
            <label>
              Buscar pedido o cliente
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setOrderPage(0);
                }}
                placeholder="Folio o nombre del cliente"
              />
            </label>
            <label>
              Estado del pedido
              <select
                value={orderStatus}
                onChange={(event) => {
                  setOrderStatus(event.target.value);
                  setOrderPage(0);
                }}
              >
                <option value="all">Todos los cobrados</option>
                <option value="unsettled">Por liquidar</option>
                <option value="pending">Listos para recibir</option>
                <option value="accepted">Recibidos</option>
              </select>
            </label>
            <small role="status">{filteredOrders.length} pedidos</small>
          </div>
          {!filteredOrders.length && (
            <div className="empty">
              No hay pedidos que coincidan con estos filtros.
            </div>
          )}
          <div className="settlement-orders">
            {filteredOrders
              .slice(visiblePage * 12, (visiblePage + 1) * 12)
              .map((order) => {
                const payment = order.payment;
                const pending =
                  payment &&
                  detail.requests.find(
                    (request) =>
                      request.scope === "order" &&
                      request.status === "pending" &&
                      request.paymentIds.includes(payment.id),
                  );
                const accepted = order.settlementStatus === "accepted";
                return (
                  <section
                    className="panel settlement-order"
                    key={order.shipmentId}
                  >
                    <button
                      className="settlement-client"
                      onClick={() => setOpenedOrder(order.shipmentId)}
                    >
                      <small>{order.orderName}</small>
                      <strong>{order.customer}</strong>
                      <span
                        className={"badge " + (order.settlementStatus ?? "")}
                      >
                        {
                          settlementOrderStatus[
                            order.settlementStatus ?? "unsettled"
                          ]
                        }
                      </span>
                    </button>
                    <div className="settlement-order-amount">
                      <small>
                        {accepted
                          ? "Recibido"
                          : payment?.method === "credit"
                            ? "Importe a crédito"
                            : "Monto a entregar"}{" "}
                        · {payment && methodName[payment.method]}
                      </small>
                      <strong>
                        {money(
                          payment?.method === "credit"
                            ? payment.expected
                            : payment?.received,
                          payment?.currency ?? null,
                        )}
                      </strong>
                      {payment?.method === "mixed" && (
                        <small>
                          💵 {money(payment.cashReceived, payment.currency)} ·
                          🏦 {money(payment.transferReceived, payment.currency)}
                        </small>
                      )}
                    </div>
                    <div className="settlement-order-actions">
                      <button onClick={() => setOpenedOrder(order.shipmentId)}>
                        Ver pedido y cobro
                      </button>
                      <button
                        className="primary"
                        disabled={busy || !pending || accepted}
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
                    </div>
                    {!pending && !accepted && (
                      <small className="muted">
                        {order.settlementStatus === "pending"
                          ? "Incluido en una solicitud de toda la ruta."
                          : "Esperando que el chofer pulse Liquidar."}
                      </small>
                    )}
                  </section>
                );
              })}
          </div>
          {filteredOrders.length > 12 && (
            <div className="toolbar">
              <button
                disabled={visiblePage === 0}
                onClick={() => setOrderPage(visiblePage - 1)}
              >
                Pedidos anteriores
              </button>
              <span>
                Página {visiblePage + 1} de {lastOrderPage + 1}
              </span>
              <button
                disabled={visiblePage === lastOrderPage}
                onClick={() => setOrderPage(visiblePage + 1)}
              >
                Más pedidos
              </button>
            </div>
          )}
          <details className="panel settlement-history">
            <summary className="panel-header">
              <h2>Solicitudes e historial · {detail.requests.length}</h2>
            </summary>
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
          </details>
        </>
      )}
      {selectedOrder && selected && (
        <SettlementOrderModal
          order={selectedOrder}
          executionId={selected}
          close={() => setOpenedOrder(null)}
          accept={
            !busy &&
            detail?.requests.some(
              (request) =>
                request.scope === "order" &&
                request.status === "pending" &&
                selectedOrder.payment &&
                request.paymentIds.includes(selectedOrder.payment.id),
            )
              ? () => {
                  const request = detail!.requests.find(
                    (item) =>
                      item.scope === "order" &&
                      item.status === "pending" &&
                      selectedOrder.payment &&
                      item.paymentIds.includes(selectedOrder.payment.id),
                  )!;
                  setOpenedOrder(null);
                  setNote("");
                  setConfirmation({
                    request,
                    decision: "accepted",
                    commandId: crypto.randomUUID(),
                  });
                }
              : undefined
          }
        />
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
                      {money(
                        o.payment!.method === "credit"
                          ? o.payment!.expected
                          : o.payment!.received,
                        o.payment!.currency,
                      )}
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
