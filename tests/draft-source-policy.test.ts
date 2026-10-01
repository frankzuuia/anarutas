import { expect, it } from "vitest";
import { observedDraftShipment } from "../src/core/draft-source-sync";
import { buildFinancialSnapshot } from "../src/core/financial-policy";
import { financialObservation, financialTarget } from "./helpers/financial";

import type { SourceShipment } from "../src/core/orders-contract";

function source(): SourceShipment {
  return {
    pickingId: 1,
    orderId: 1,
    partnerId: 1,
    pickingName: "OUT/QA",
    orderName: "QA",
    customerName: "Cliente",
    address: "Domicilio",
    validatedAt: null,
    promisedAt: null,
    backorderId: null,
    fulfillmentStatus: "pending_validation",
    odooPickingState: "assigned",
    lines: [
      {
        moveId: 100,
        productId: 2,
        name: "Nombre del producto",
        quantity: 3,
        unit: "kg",
        pickerNote: "Nota de surtido",
      },
    ],
  };
}
it("refreshes quantities/status by exact movement, preserves names/notes, excludes zero/canceled and adds actual product identities", () => {
  const observation = financialObservation();
  observation.moves[0].quantity = "3.2";
  observation.moves.push(
    {
      ...observation.moves[0],
      id: 101,
      productId: 9,
      productName: "Producto nuevo",
      saleLineId: null,
      quantity: "1",
    },
    { ...observation.moves[0], id: 102, quantity: "0" },
    { ...observation.moves[0], id: 103, state: "cancel" },
    { ...observation.moves[0], id: 104, pickingId: 8 },
  );
  const snapshot = buildFinancialSnapshot(financialTarget, observation);
  const next = observedDraftShipment(source(), snapshot);
  expect(next).toMatchObject({
    fulfillmentStatus: "validated",
    validatedAt: observation.picking.validatedAt,
    customerName: "Cliente",
    address: "Domicilio",
    lines: [
      {
        name: "Nombre del producto",
        quantity: 3.2,
        moveId: 100,
        pickerNote: "Nota de surtido",
        saleLineId: 10,
        uomId: 3,
      },
      { name: "Producto nuevo", productId: 9, moveId: 101, quantity: 1 },
    ],
  });
  expect(next.lines[1]).not.toHaveProperty("pickerNote");
  observation.picking.state = "assigned";
  observation.picking.validatedAt = null;
  observation.moves = [observation.moves[0]];
  observation.moves[0].demand = "4.9";
  expect(
    observedDraftShipment(
      source(),
      buildFinancialSnapshot(financialTarget, observation),
    ),
  ).toMatchObject({
    fulfillmentStatus: "pending_validation",
    lines: [{ quantity: 4.9 }],
  });
  observation.picking.state = "done";
  expect(
    observedDraftShipment(
      source(),
      buildFinancialSnapshot(financialTarget, observation),
    ).fulfillmentStatus,
  ).toBe("pending_validation");
});
it("does not reuse names or notes for a changed product and rejects missing names/identity/invalid quantities", () => {
  const observation = financialObservation();
  const snapshot = () => buildFinancialSnapshot(financialTarget, observation);
  observation.moves[0].productId = 9;
  observation.moves[0].productName = "Producto sustituido";
  expect(observedDraftShipment(source(), snapshot()).lines[0]).toMatchObject({
    productId: 9,
    name: "Producto sustituido",
  });
  expect(
    observedDraftShipment(source(), snapshot()).lines[0],
  ).not.toHaveProperty("pickerNote");
  delete observation.moves[0].productName;
  expect(() => observedDraftShipment(source(), snapshot())).toThrow(
    "ODOO_FINANCIAL_INVALID_RESPONSE",
  );
  observation.moves[0].productId = 2;
  const previous = source();
  previous.lines = [];
  expect(observedDraftShipment(previous, snapshot()).lines[0].name).toBe(
    "Producto",
  );
  for (const key of ["pickingId", "orderId", "partnerId"] as const)
    expect(() =>
      observedDraftShipment({ ...source(), [key]: 9 }, snapshot()),
    ).toThrow("FINANCIAL_IDENTITY_CHANGED");
  expect(() =>
    observedDraftShipment(source(), {
      ...snapshot(),
      picking: { ...snapshot().picking, partnerId: 9 },
    }),
  ).toThrow("FINANCIAL_IDENTITY_CHANGED");
  for (const quantity of ["-1", "1e400"]) {
    const invalid = snapshot();
    invalid.observation.moves[0].quantity = quantity;
    expect(() => observedDraftShipment(source(), invalid)).toThrow(
      "ODOO_FINANCIAL_INVALID_RESPONSE",
    );
  }
});
it.each(["picking", "order"] as const)(
  "reflects canceled %s without keeping stale validated lines",
  (field) => {
    const observation = financialObservation();
    observation[field].state = "cancel";
    expect(
      observedDraftShipment(
        source(),
        buildFinancialSnapshot(financialTarget, observation),
      ),
    ).toMatchObject({ fulfillmentStatus: "cancelled", lines: [] });
  },
);

it("preserves original line order while appended movements sort by identity even if Odoo reorders its rows", () => {
  const observation = financialObservation(),
    previous = source();
  previous.lines.push(
    { ...previous.lines[0], moveId: 50 },
    { ...previous.lines[0], moveId: 25 },
  );
  observation.moves = [300, 25, 50, 200, 100].map((id) => ({
    ...observation.moves[0],
    id,
    quantity: "1",
  }));
  expect(
    observedDraftShipment(
      previous,
      buildFinancialSnapshot(financialTarget, observation),
    ).lines.map((line) => line.moveId),
  ).toEqual([100, 50, 25, 200, 300]);
  const permutations = (ids: number[]): number[][] =>
    ids.length === 0
      ? [[]]
      : ids.flatMap((id, index) =>
          permutations(ids.filter((_, position) => position !== index)).map(
            (tail) => [id, ...tail],
          ),
        );
  for (const ids of permutations([300, 25, 50, 200, 100])) {
    observation.moves = ids.map((id) => ({
      ...observation.moves[0],
      id,
      quantity: "1",
    }));
    expect(
      observedDraftShipment(
        previous,
        buildFinancialSnapshot(financialTarget, observation),
      ).lines.map((line) => line.moveId),
    ).toEqual([100, 50, 25, 200, 300]);
  }
});
it("never treats an assigned picking as done merely because it retains a validation date", () => {
  const observation = financialObservation();
  observation.picking.state = "assigned";
  observation.moves[0].demand = "4.9";
  observation.moves[0].quantity = "3.2";
  expect(
    observedDraftShipment(
      source(),
      buildFinancialSnapshot(financialTarget, observation),
    ),
  ).toMatchObject({
    fulfillmentStatus: "pending_validation",
    lines: [{ quantity: 4.9 }],
  });
});
it("cannot borrow a sale-line name from another sale identity and never emits a null saleLineId", () => {
  const observation = financialObservation(),
    previous = source();
  previous.lines = [];
  delete observation.moves[0].productName;
  observation.moves[0].saleLineId = 999;
  expect(() =>
    observedDraftShipment(
      previous,
      buildFinancialSnapshot(financialTarget, observation),
    ),
  ).toThrow("ODOO_FINANCIAL_INVALID_RESPONSE");
  observation.moves[0].productName = "Producto sin línea de venta";
  observation.moves[0].saleLineId = null;
  expect(
    observedDraftShipment(
      previous,
      buildFinancialSnapshot(financialTarget, observation),
    ).lines[0],
  ).not.toHaveProperty("saleLineId");
});
