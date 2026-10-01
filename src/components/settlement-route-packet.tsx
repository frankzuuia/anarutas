"use client";
import { useEffect, useRef } from "react";
import { Check, Wallet, X, ChevronRight } from "lucide-react";
import type { readSettlementDetail } from "@/core/finance-read";
import { displayMoney as money } from "@/core/financial-display";
import {
  MoneySummary,
  methodName,
  settlementOrderStatus,
} from "./settlement-presentation";
type Detail = Awaited<ReturnType<typeof readSettlementDetail>>;
type Packet = Detail["requests"][number];

export function routePacket(detail: Detail) {
  return (
    detail.requests.find(
      (request) => request.scope === "route" && request.status === "pending",
    ) ??
    detail.requests.find(
      (request) => request.scope === "route" && request.status === "accepted",
    ) ??
    (detail.work.eligible || detail.work.completion
      ? undefined
      : detail.requests.find((request) => request.scope === "route"))
  );
}
function packetOrders(detail: Detail, packet?: Packet) {
  const ids =
    packet?.paymentIds ??
    (detail.work.eligible || detail.work.completion
      ? detail.work.summary.paymentIds
      : detail.routeSettlement.paymentIds);
  return detail.orders.filter(
    (order) => order.payment && ids.includes(order.payment.id),
  );
}

export function SettlementRouteCard({
  detail,
  busy,
  open,
  receive,
}: {
  detail: Detail;
  busy: boolean;
  open: () => void;
  receive: (packet: Packet) => void;
}) {
  const packet = routePacket(detail);
  const received =
    packet?.status === "accepted" ||
    (!packet && (detail.work.eligible || Boolean(detail.work.completion)));
  return (
    <section
      className="panel settlement-route-card"
      aria-label="Liquidación de toda la ruta"
    >
      <button className="settlement-route-open" disabled={busy} onClick={open}>
        <Wallet size={22} />
        <span>
          <strong>Liquidación de toda la ruta</strong>
          <small>
            {packetOrders(detail, packet).length} pedidos · {detail.route.label}
          </small>
        </span>
        <span className="badge">
          {received
            ? "Recibida"
            : packet?.status === "pending"
              ? "Lista para recibir"
              : "Esperando al chofer"}
        </span>
        <ChevronRight size={18} />
      </button>
      <div className="toolbar">
        <span className="muted">
          {packet?.status === "pending"
            ? "El chofer confirmó este paquete de cobros."
            : received
              ? "Recepción guardada. Puedes consultar cada ticket."
              : "Disponible cuando el chofer envíe la liquidación desde bodega."}
        </span>
        <button
          className="primary"
          disabled={busy || packet?.status !== "pending"}
          onClick={() => packet && receive(packet)}
        >
          <Check size={16} />
          {received ? "Recibida" : "Aceptar liquidación de ruta"}
        </button>
      </div>
    </section>
  );
}

export function SettlementRoutePacketModal({
  detail,
  busy,
  close,
  openOrder,
  receive,
}: {
  detail: Detail;
  busy: boolean;
  close: () => void;
  openOrder: (shipmentId: string) => void;
  receive: (packet: Packet) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => trigger?.focus();
  }, []);
  const packet = routePacket(detail);
  const orders = packetOrders(detail, packet);
  const received =
    packet?.status === "accepted" ||
    (!packet && (detail.work.eligible || Boolean(detail.work.completion)));
  return (
    <dialog
      ref={ref}
      className="fleet-dialog settlement-dialog settlement-packet-dialog"
      aria-labelledby="route-packet-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="modal-header">
        <div>
          <small>
            {detail.route.driver} · {detail.route.date}
          </small>
          <h2 id="route-packet-title">
            {detail.route.label} · Liquidación de ruta
          </h2>
        </div>
        <button
          aria-label="Cerrar liquidación de ruta"
          disabled={busy}
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      <div className="modal-body stack">
        <MoneySummary
          title="Importes de este paquete"
          totals={
            packet?.totals ??
            (received ? detail.acceptedTotals : detail.routeSettlement.totals)
          }
        />
        <h3>Pedidos incluidos · {orders.length}</h3>
        <div className="settlement-packet-orders">
          {orders.map((order) => {
            const payment = order.payment!;
            return (
              <button
                key={order.shipmentId}
                className="settlement-packet-order"
                disabled={busy}
                onClick={() => openOrder(order.shipmentId)}
              >
                <span>
                  <strong>{order.customer}</strong>
                  <small>{order.orderName}</small>
                </span>
                <span className="badge">
                  {settlementOrderStatus[order.settlementStatus ?? "unsettled"]}
                </span>
                <span>{methodName[payment.method]}</span>
                <strong>
                  {money(
                    payment.method === "credit"
                      ? payment.expected
                      : payment.received,
                    payment.currency,
                  )}
                </strong>
                <ChevronRight size={16} />
              </button>
            );
          })}
        </div>
        {!orders.length && (
          <p className="muted">No quedan cobros en este paquete.</p>
        )}
        {packet?.status === "accepted" && (
          <small className="muted">
            {packet.receiver} ·{" "}
            {packet.decidedAt && new Date(packet.decidedAt).toLocaleString()}
          </small>
        )}
      </div>
      <div className="modal-footer">
        <button disabled={busy} onClick={close}>
          Cancelar
        </button>
        <button
          className="primary"
          disabled={busy || packet?.status !== "pending"}
          onClick={() => packet && receive(packet)}
        >
          <Check size={16} />
          {received ? "Recibida" : "Aceptar liquidación de ruta"}
        </button>
      </div>
    </dialog>
  );
}
