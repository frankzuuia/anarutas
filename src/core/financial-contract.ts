/** Decimal strings preserve the source values across JSON, PostgreSQL and clients. */
export type FinancialAmounts = { untaxed: string; tax: string; total: string };
export type FinancialTarget = {
  source: string;
  pickingId: number;
  orderId: number;
  partnerId: number;
};
export type FinancialCurrency = {
  id: number;
  name: string;
  rounding: string;
  decimalPlaces: number;
};
export type FinancialSaleLine = {
  id: number;
  productId: number | null;
  name: string;
  displayType: string | null;
  uomId: number | null;
  uom: string | null;
  currencyId: number;
  quantity: string;
  delivered: string;
  unitPrice: string;
  discount: string;
  taxIds: number[];
  amounts: FinancialAmounts;
  writeDate: string;
};
export type FinancialMove = {
  id: number;
  saleLineId: number | null;
  pickingId: number | null;
  productId: number;
  productName?: string;
  uomId: number;
  uom: string;
  demand: string;
  quantity: string;
  state: string;
  returnedMoveId: number | null;
  writeDate: string;
};
export type FinancialPicking = {
  id: number;
  name: string;
  partnerId: number | null;
  state: string;
  outgoing: boolean;
  customerDestination: boolean;
  validatedAt: string | null;
  writeDate: string;
};
export type FinancialObservation = {
  companyId: number;
  picking: FinancialPicking;
  order: {
    id: number;
    name: string;
    state: string;
    writeDate: string;
    amounts: FinancialAmounts;
  };
  currency: FinancialCurrency;
  saleLines: FinancialSaleLine[];
  moves: FinancialMove[];
  relatedPickings: FinancialPicking[];
};
export type FinancialReason =
  | "ORDER_NOT_CONFIRMED"
  | "NOT_CUSTOMER_DELIVERY"
  | "NO_DELIVERY_LINES"
  | "UNLINKED_MOVE"
  | "MOVE_NOT_VALIDATED"
  | "SPLIT_DELIVERY"
  | "RETURNED_STOCK"
  | "SALE_LINE_NOT_DELIVERED"
  | "UOM_MISMATCH"
  | "PRODUCT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "QUANTITY_MISMATCH"
  | "UNSUPPORTED_SIGN"
  | "AMOUNT_MISMATCH";
export type FinancialSnapshot = {
  contractVersion: 1;
  target: FinancialTarget;
  companyId: number;
  status: "pending_validation" | "ready" | "needs_review" | "cancelled";
  reasons: FinancialReason[];
  currency: FinancialCurrency;
  picking: FinancialPicking;
  order: FinancialObservation["order"];
  /** Always scoped to the complete sale order, never implicitly to this picking. */
  saleLines: FinancialSaleLine[];
  lines: (FinancialMove & { saleLineId: number })[];
  shipmentAmounts: FinancialAmounts | null;
  roundingAdjustment: string | null;
  /** Complete evidence includes other moves/pickings used to reject double allocation. */
  observation: FinancialObservation;
};
