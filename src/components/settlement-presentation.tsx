"use client";
import { X, Wallet, ArrowUpRight, CreditCard } from "lucide-react";
import { useEffect, useRef } from "react";
import type { readSettlementDetail } from "@/core/finance-read";
import type { paymentTotals } from "@/core/payment-policy";
import {
  displayMoney as money,
  displayQuantity as quantity,
} from "@/core/financial-display";
import {
  productIncidentNames,
  type ProductIncidentKind,
} from "@/core/product-incidents-policy";

type Detail = Awaited<ReturnType<typeof readSettlementDetail>>;
type Order = Detail["orders"][number];
type Total = ReturnType<typeof paymentTotals>[number];
export const methodName = {
  cash: "Efectivo",
  transfer: "Transferencia",
  credit: "Crédito",
  mixed: "Efectivo + transferencia",
};
export const settlementOrderStatus: Record<string, string> = {
  unsettled: "Por liquidar",
  pending: "Listo para recibir",
  accepted: "Recibido",
};

export function MoneySummary({
  totals,
  title,
}: {
  totals: Total[];
  title: string;
}) {
  if (!totals.length) return null;
  return (
    <section className="settlement-summary" aria-label={title}>
      <h3>{title}</h3>
      {totals.map((total) => (
        <div
          className="stack"
          key={`${total.currency.id}:${total.currency.name}`}
        >
          <div className="settlement-methods">
            {(
              [
                ["cash", "Efectivo", Wallet],
                ["transfer", "Transferencias", ArrowUpRight],
                ["credit", "Crédito", CreditCard],
              ] as const
            ).map(([key, label, Icon]) => (
              <div className={`settlement-method ${key}`} key={key}>
                <span>
                  <Icon size={18} />
                  {label}
                </span>
                <strong>{money(total[key], total.currency)}</strong>
              </div>
            ))}
          </div>
          {Number(total.balance) !== 0 && (
            <small>
              Clientes con pago parcial pendiente:{" "}
              {money(total.balance, total.currency)}
            </small>
          )}
          {Number(total.deferred) !== 0 && (
            <small>
              Se cobrará al entregar las reposiciones:{" "}
              {money(total.deferred, total.currency)}
            </small>
          )}
        </div>
      ))}
    </section>
  );
}

export function SettlementOrderModal({
  order,
  executionId,
  close,
  accept,
}: {
  order: Order;
  executionId: string;
  close: () => void;
  accept?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      trigger?.focus();
    };
  }, []);
  const payment = order.payment;
  const source = payment?.snapshot ?? order;
  const financial = source.financial,
    totals = financial?.totals,
    currency = financial?.currency ?? null;
  return (
    <dialog
      ref={ref}
      className="fleet-dialog settlement-dialog settlement-detail-dialog"
      aria-labelledby="settlement-order-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="modal-header">
        <div>
          <small>{order.orderName} · Pedido y cobro</small>
          <h2 id="settlement-order-title">{order.customer}</h2>
        </div>
        <button
          onClick={close}
          aria-label="Cerrar detalle del pedido"
          autoFocus
        >
          <X size={20} />
        </button>
      </header>
      <div className="modal-body settlement-receipt-body">
        {payment && (
          <div className="settlement-receipt-heading">
            <span>{methodName[payment.method]}</span>
            <small>
              {new Date(payment.recordedAt).toLocaleString("es-MX")}
            </small>
          </div>
        )}
        {order.changedAfterPayment && (
          <p className="notice">
            La fuente cambió después del cobro. Este detalle conserva los
            importes confirmados.
          </p>
        )}
        <section className="settlement-products" aria-label="Pedido completo">
          <h3>
            Pedido completo{" "}
            <small>
              {financial?.lines.length ?? 0}{" "}
              {financial?.lines.length === 1 ? "partida" : "partidas"}
            </small>
          </h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Unitario</th>
                  <th>Original</th>
                  <th>Final</th>
                </tr>
              </thead>
              <tbody>
                {financial?.lines.map((line) => (
                  <tr key={line.moveId}>
                    <td>
                      {source.order?.lines[line.lineIndex]?.name ??
                        `Partida ${line.lineIndex + 1}`}
                    </td>
                    <td data-label="Cantidad">
                      {quantity(line.quantity)} {line.unit}
                    </td>
                    <td data-label="Unitario">
                      {money(line.unitPrice, currency)}
                    </td>
                    <td data-label="Original">{money(line.total, currency)}</td>
                    <td data-label="Final">{money(line.net, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {totals && (
          <section
            className="settlement-order-totals"
            aria-label="Desglose del pedido"
          >
            <span>
              Total original <b>{money(totals.original, currency)}</b>
            </span>
            {Number(totals.deduction) !== 0 && (
              <span className="settlement-deduction">
                Devoluciones y faltantes{" "}
                <b>− {money(totals.deduction, currency)}</b>
              </span>
            )}
            {Number(totals.deferred) !== 0 && (
              <span>
                Reposiciones por cobrar después{" "}
                <b>− {money(totals.deferred, currency)}</b>
              </span>
            )}
            <span className="settlement-net">
              Total final <b>{money(totals.net, currency)}</b>
            </span>
            {payment && (
              <strong className="settlement-collected">
                {payment.method === "credit"
                  ? "Total a crédito"
                  : "Total cobrado"}
                <b>
                  {money(
                    payment.method === "credit"
                      ? payment.expected
                      : payment.received,
                    payment.currency,
                  )}
                </b>
              </strong>
            )}
            {payment?.method === "mixed" && (
              <small>
                Efectivo {money(payment.cashReceived, payment.currency)} ·
                Transferencia{" "}
                {money(payment.transferReceived, payment.currency)}
              </small>
            )}
            {payment && Number(payment.balance) !== 0 && (
              <small>
                {payment.method === "credit"
                  ? "Crédito del cliente"
                  : "Saldo del cliente"}
                : {money(payment.balance, payment.currency)}
              </small>
            )}
          </section>
        )}
        {source.incidents.length > 0 && (
          <section
            className="settlement-incidents"
            aria-label="Incidencias al confirmar"
          >
            <h3>Devoluciones e incidencias</h3>
            {source.incidents.map((incident) => {
              const amount = order.incidentDisplay.amounts.find(
                (item) => item.id === incident.id,
              );
              return (
                <article className="settlement-incident" key={incident.id}>
                  <div className="settlement-incident-line">
                    <strong>
                      {incident.product}{" "}
                      <span>
                        · {quantity(incident.quantity)} {incident.unit}
                      </span>
                    </strong>
                    <b>
                      {amount?.deduction == null
                        ? "Descuento por revisar"
                        : Number(amount.deduction) !== 0
                          ? `− ${money(amount.deduction, currency)}`
                          : "Sin descuento"}
                    </b>
                  </div>
                  <p>
                    {productIncidentNames[
                      incident.kind as ProductIncidentKind
                    ] ?? incident.kind}
                    {incident.status === "canceled" && " · Cancelada"}
                    {incident.note && ` · ${incident.note}`}
                  </p>
                  {amount?.deferred != null &&
                    Number(amount.deferred) !== 0 && (
                      <p>
                        Por cobrar al entregar la reposición:{" "}
                        {money(amount.deferred, currency)}
                      </p>
                    )}
                  <div className="settlement-evidence">
                    {[
                      ...new Set([
                        incident.evidence_id,
                        ...incident.evidence_ids,
                      ]),
                    ]
                      .filter(Boolean)
                      .map((photo, index) => (
                        <a
                          target="_blank"
                          rel="noreferrer"
                          key={photo}
                          href={`/api/settlements/${executionId}/evidence?incidentId=${incident.id}&photoId=${photo}`}
                        >
                          Ver foto {index + 1}
                        </a>
                      ))}
                  </div>
                </article>
              );
            })}
            {order.incidentDisplay.deductionRounding != null &&
              Number(order.incidentDisplay.deductionRounding) !== 0 && (
                <small>
                  Redondeo incluido en las devoluciones:{" "}
                  {money(order.incidentDisplay.deductionRounding, currency)}
                </small>
              )}
            {order.incidentDisplay.deferredRounding != null &&
              Number(order.incidentDisplay.deferredRounding) !== 0 && (
                <small>
                  Redondeo de reposiciones:{" "}
                  {money(order.incidentDisplay.deferredRounding, currency)}
                </small>
              )}
          </section>
        )}
        {payment && Number(payment.change) !== 0 && (
          <p>
            Cambio registrado en el recibo anterior:{" "}
            {money(payment.change, payment.currency)}
          </p>
        )}
        {payment?.note && (
          <section>
            <h3>Notas del chofer</h3>
            <p>{payment.note}</p>
          </section>
        )}
      </div>
      <footer className="modal-footer">
        <button onClick={close}>Cerrar detalle</button>
        <button className="primary" disabled={!accept} onClick={accept}>
          {order.settlementStatus === "accepted" ? "Recibido" : "Aceptar"}
        </button>
      </footer>
    </dialog>
  );
}
