import type {
  FinancialObservation,
  FinancialTarget,
} from "../../src/core/financial-contract";

// Deterministic domain inputs for arithmetic/invariants; never an Odoo/API substitute.
export const financialTarget: FinancialTarget = {
  source: "financial-domain-qa",
  pickingId: 1,
  orderId: 1,
  partnerId: 1,
};
export function financialObservation(): FinancialObservation {
  const date = "2026-09-30T14:16:49.000Z";
  const picking = {
    id: 1,
    name: "OUT/QA",
    partnerId: 1,
    state: "done",
    outgoing: true,
    customerDestination: true,
    validatedAt: date,
    writeDate: date,
  };
  return {
    companyId: 1,
    picking,
    relatedPickings: [structuredClone(picking)],
    currency: { id: 1, name: "MXN", rounding: "0.01", decimalPlaces: 2 },
    order: {
      id: 1,
      name: "QA",
      state: "sale",
      writeDate: date,
      amounts: { untaxed: "20", tax: "0", total: "20" },
    },
    saleLines: [
      {
        id: 10,
        productId: 2,
        name: "Producto",
        displayType: null,
        uomId: 3,
        uom: "kg",
        currencyId: 1,
        quantity: "2",
        delivered: "2",
        unitPrice: "10",
        discount: "0",
        taxIds: [],
        amounts: { untaxed: "20", tax: "0", total: "20" },
        writeDate: date,
      },
    ],
    moves: [
      {
        id: 100,
        saleLineId: 10,
        pickingId: 1,
        productId: 2,
        productName: "Producto",
        uomId: 3,
        uom: "kg",
        demand: "2",
        quantity: "2",
        state: "done",
        returnedMoveId: null,
        writeDate: date,
      },
    ],
  };
}
