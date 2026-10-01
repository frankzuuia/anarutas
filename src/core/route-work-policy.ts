import type { PaymentRecord } from "./payments";
import { paymentTotals } from "./payment-policy";
import { financialHash } from "./financial-policy";
import { sumFinancial } from "./financial-values";

export type WorkOrder = { shipmentId: string; status: string };
export type WorkRequest = { status: string; paymentIds: string[] };
export function settlementRouteReady(
  completed: boolean,
  warehouseRequired: boolean,
  orders: { status: string }[],
) {
  return (
    completed ||
    (!warehouseRequired &&
      orders.length > 0 &&
      orders.every((order) => order.status === "delivered"))
  );
}
export type WorkReceipt = Pick<
  PaymentRecord,
  | "id"
  | "shipmentId"
  | "currency"
  | "expected"
  | "received"
  | "tendered"
  | "change"
  | "method"
  | "balance"
  | "deferred"
  | "cashReceived"
  | "transferReceived"
> & {
  snapshot: { incidents: { id: string; status: string }[] };
};

function acceptedIds(requests: WorkRequest[]) {
  return new Set(
    requests
      .filter((request) => request.status === "accepted")
      .flatMap((request) => request.paymentIds),
  );
}
function hasMissingPayment(orders: WorkOrder[], payments: WorkReceipt[]) {
  const paid = new Set(payments.map((payment) => payment.shipmentId));
  return orders.some(
    (order) => order.status === "delivered" && !paid.has(order.shipmentId),
  );
}

export function routeSettlementReview(
  executionId: string,
  completed: boolean,
  orders: WorkOrder[],
  payments: WorkReceipt[],
  requests: WorkRequest[],
  warehouseRequired = true,
) {
  const accepted = acceptedIds(requests);
  const pending = new Set(
    requests
      .filter((request) => request.status === "pending")
      .flatMap((request) => request.paymentIds),
  );
  const selected = payments.filter((payment) => !accepted.has(payment.id));
  const paymentIds = selected.map((payment) => payment.id).sort();
  const totals = paymentTotals(selected);
  const reason = !settlementRouteReady(completed, warehouseRequired, orders)
    ? warehouseRequired
      ? "SETTLEMENT_ROUTE_NOT_FINISHED"
      : "SETTLEMENT_ORDERS_NOT_DELIVERED"
    : hasMissingPayment(orders, payments)
      ? "SETTLEMENT_PAYMENTS_MISSING"
      : selected.some((payment) => pending.has(payment.id))
        ? "SETTLEMENT_REQUEST_PENDING"
        : !selected.length
          ? "SETTLEMENT_NOTHING_PENDING"
          : null;
  return {
    eligible: reason === null,
    warehouseRequired,
    reason,
    paymentIds,
    totals,
    basis: financialHash({ executionId, paymentIds, totals }),
  };
}

export function routeWorkSummary(orders: WorkOrder[], payments: WorkReceipt[]) {
  const currencies = new Map(
    payments.map((payment) => [
      `${payment.currency.id}:${payment.currency.name}`,
      payment.currency,
    ]),
  );
  return {
    contractVersion: 1,
    deliveredOrders: orders.filter((order) => order.status === "delivered")
      .length,
    incidents: new Set(
      payments.flatMap((payment) =>
        payment.snapshot.incidents
          .filter((incident) => incident.status !== "canceled")
          .map((incident) => incident.id),
      ),
    ).size,
    paymentIds: payments.map((payment) => payment.id).sort(),
    totals: [...currencies.entries()].map(([key, currency]) => ({
      currency,
      total: sumFinancial(
        payments
          .filter(
            (payment) =>
              `${payment.currency.id}:${payment.currency.name}` === key,
          )
          .map((payment) => payment.expected),
      ).toFixed(),
    })),
  };
}

export function routeWorkReview(
  executionId: string,
  completed: boolean,
  orders: WorkOrder[],
  payments: WorkReceipt[],
  requests: WorkRequest[],
  warehouseRequired = true,
) {
  const accepted = acceptedIds(requests);
  const summary = routeWorkSummary(orders, payments);
  const reason = !settlementRouteReady(completed, warehouseRequired, orders)
    ? warehouseRequired
      ? "SETTLEMENT_ROUTE_NOT_FINISHED"
      : "SETTLEMENT_ORDERS_NOT_DELIVERED"
    : hasMissingPayment(orders, payments)
      ? "SETTLEMENT_PAYMENTS_MISSING"
      : !payments.length ||
          payments.some((payment) => !accepted.has(payment.id))
        ? "WORK_SETTLEMENT_PENDING"
        : null;
  return {
    eligible: reason === null,
    warehouseRequired,
    reason,
    summary,
    basis: financialHash({ executionId, summary }),
  };
}
