import type {
  FinancialCurrency,
  FinancialSnapshot,
} from "./financial-contract";
import type { ShipmentLine } from "./orders-contract";

export type ReplacementPayment = "pay_full" | "defer";
export type IncidentFinancialReference = {
  revision: number;
  moveId: number;
  saleLineId: number;
};
export type FinancialPublishedLine = {
  name: string;
  quantity: number;
  unit: string;
};
export type FinancialIncidentRow = {
  id: string;
  lineIndex: number | null;
  kind: string;
  quantity: string;
  status: string;
  financialRevision: number | null;
  financialMoveId: number | null;
  financialSaleLineId: number | null;
  replacementPayment: ReplacementPayment | null;
  financialSnapshot: FinancialSnapshot | null;
};
export type DriverFinancialLine = {
  lineIndex: number;
  moveId: number;
  saleLineId: number;
  productId: number;
  uomId: number;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
  untaxed: string;
  tax: string;
  total: string;
  physicalRemaining: string;
  deduction: string | null;
  deferred: string | null;
  net: string | null;
};
export type DriverFinancialView = {
  contractVersion: 1;
  revision: number;
  status: FinancialSnapshot["status"] | "unavailable";
  fresh: boolean;
  error: string | null;
  checkedAt: string | null;
  serverTime: string;
  maxAgeSeconds: number;
  currency: FinancialCurrency | null;
  lines: DriverFinancialLine[];
  issues: string[];
  unpricedIncidentCount: number;
  totals: null | {
    original: string;
    deduction: string;
    deferred: string;
    net: string;
    roundingAdjustment: string;
    remainingRoundingAdjustment: string;
  };
};
export type FinancialProjectionInput = {
  revision: number;
  snapshot: FinancialSnapshot | null;
  lastError: string | null;
  lastSuccessAt: Date | null;
  now: Date;
  maxAgeSeconds: number;
  published: FinancialPublishedLine[];
  imported: ShipmentLine[];
  incidents: FinancialIncidentRow[];
};
