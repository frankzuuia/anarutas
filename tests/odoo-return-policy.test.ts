import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  assertReturnAvailable,
  assertReturnReceipt,
  convertReturnQuantity,
  returnCapabilities,
  returnQuantity,
  returnReference,
  validateReturnRequest,
  type ReturnRequest,
} from "../src/core/odoo-return-policy";
import { odooReturnConfig } from "../src/core/odoo-return-config";

const move17 = {
  quantity: { type: "float" },
  product_uom: { relation: "uom.uom" },
  product_uom_qty: { type: "float" },
  origin_returned_move_id: { relation: "stock.move" },
};
const picking = {
  move_ids: { relation: "stock.move" },
  return_id: { relation: "stock.picking" },
};
const request = (): ReturnRequest => ({
  id: randomUUID(),
  source: "qa-source",
  companyId: 1,
  pickingId: 1,
  orderId: 2,
  partnerId: 3,
  lines: [
    {
      moveId: 4,
      productId: 5,
      uomId: 6,
      quantity: "0.25",
      incidentIds: [randomUUID()],
    },
  ],
});
it("selects the documented 17, 19 and real 20 contracts by schema and native form buttons", () => {
  expect(
    returnCapabilities(
      ["stock.return.picking", "stock.return.picking.line"],
      move17,
      picking,
      "",
      '<button name="create_returns" type="object"/>',
    ),
  ).toMatchObject({
    mode: "wizard",
    method: "create_returns",
    unitField: "product_uom",
  });
  expect(
    returnCapabilities(
      ["stock.return.picking", "stock.return.picking.line"],
      move17,
      picking,
      "",
      "<button type='object' name='action_create_returns'/>",
    ),
  ).toMatchObject({ mode: "wizard", method: "action_create_returns" });
  expect(
    returnCapabilities(
      [],
      { ...move17, uom_id: { relation: "uom.uom" } },
      picking,
      '<button name="action_return" type="object"/>',
    ),
  ).toMatchObject({
    mode: "picking",
    method: "action_return",
    unitField: "uom_id",
  });
  for (const arch of [
    "",
    '<button name="action_return_all" type="object"/>',
    '<button name="action_return" type="action"/>',
  ])
    expect(() => returnCapabilities([], move17, picking, arch)).toThrow(
      "ODOO_RETURN_SCHEMA_UNSUPPORTED",
    );
  expect(() =>
    returnCapabilities(
      ["stock.return.picking", "stock.return.picking.line"],
      move17,
      picking,
      "",
      '<button name="action_create_exchanges" type="object"/>',
    ),
  ).toThrow();
  expect(() =>
    returnCapabilities(
      [],
      move17,
      {},
      '<button name="action_return" type="object"/>',
    ),
  ).toThrow();
});
it("requires exact original identities, unique moves, incidents and current installation scope", () => {
  const good = request();
  validateReturnRequest(good, good.source, good.companyId);
  expect(returnReference(good.id)).toContain(good.id);
  for (const bad of [
    { ...good, source: "other" },
    { ...good, companyId: 2 },
  ])
    expect(() => validateReturnRequest(bad, good.source, 1)).toThrow(
      "ODOO_RETURN_SCOPE_CHANGED",
    );
  for (const bad of [
    { ...good, pickingId: 0 },
    { ...good, lines: [] },
    { ...good, lines: [...good.lines, good.lines[0]] },
    { ...good, lines: [{ ...good.lines[0], uomId: 0 }] },
    { ...good, lines: [{ ...good.lines[0], incidentIds: [] }] },
  ])
    expect(() => validateReturnRequest(bad, good.source, 1)).toThrow(
      "ODOO_RETURN_IDENTITY_INVALID",
    );
});
it("preserves exact fractions and rejects excessive, nonfinite, unsupported quantities", () => {
  for (const bad of [
    0,
    -1,
    "NaN",
    "Infinity",
    null,
    {},
    "0.0000001",
    "1000000000000",
  ])
    expect(() => returnQuantity(bad)).toThrow("ODOO_RETURN_QUANTITY_INVALID");
  expect(returnQuantity("0000.250000")).toBe("0.25");
  assertReturnAvailable("0.25", 2, [1, "0.75"]);
  expect(() => assertReturnAvailable("0.250001", 2, [1, "0.75"])).toThrow(
    "ODOO_RETURN_QUANTITY_EXCEEDED",
  );
  for (const bad of ["NaN", "bad", null, -1, "Infinity"])
    expect(() => assertReturnAvailable("0.25", bad, [])).toThrow(
      "ODOO_RETURN_IDENTITY_INVALID",
    );
  expect(() => assertReturnAvailable("0.25", 1, [-1])).toThrow(
    "ODOO_RETURN_IDENTITY_INVALID",
  );
});
it("accepts only the exact selected products and quantities in an unvalidated return", () => {
  const good = request(),
    receipt = {
      id: 9,
      name: returnReference(good.id),
      state: "assigned",
      lines: [{ id: 10, ...good.lines[0] }],
    };
  assertReturnReceipt(good, receipt);
  for (const id of [0, -1, 1.1])
    expect(() => assertReturnReceipt(good, { ...receipt, id })).toThrow(
      "ODOO_RETURN_REMOTE_CHANGED",
    );
  for (const state of ["done", "cancel", "unknown"])
    expect(() => assertReturnReceipt(good, { ...receipt, state })).toThrow(
      "ODOO_RETURN_REMOTE_CHANGED",
    );
  for (const bad of [
    { ...receipt, name: "manual" },
    { ...receipt, lines: [] },
    { ...receipt, lines: [...receipt.lines, receipt.lines[0]] },
    { ...receipt, lines: [{ ...receipt.lines[0], quantity: "0.3" }] },
    { ...receipt, lines: [{ ...receipt.lines[0], productId: 7 }] },
    { ...receipt, lines: [{ ...receipt.lines[0], moveId: 7 }] },
    { ...receipt, lines: [{ ...receipt.lines[0], uomId: 7 }] },
  ])
    expect(() => assertReturnReceipt(good, bad)).toThrow(
      "ODOO_RETURN_REMOTE_CHANGED",
    );
});
it("converts the legacy wizard product unit without changing the reported move quantity", () => {
  const kg = { factor: "1", categoryId: 1 },
    g = { factor: "1000", categoryId: 1 };
  expect(convertReturnQuantity("0.25", kg, g)).toBe("250");
  expect(convertReturnQuantity("250", g, kg)).toBe("0.25");
  for (const unit of [
    { ...g, categoryId: 2 },
    { ...g, factor: "0" },
    { ...g, factor: "-1" },
    { ...g, factor: "NaN" },
  ])
    expect(() => convertReturnQuantity("1", kg, unit)).toThrow(
      "ODOO_RETURN_UOM_UNSUPPORTED",
    );
  expect(() => convertReturnQuantity("0.000001", g, kg)).toThrow(
    "ODOO_RETURN_UOM_PRECISION",
  );
});
it("defaults disabled and requires an explicit valid installation setting", () => {
  expect(odooReturnConfig({})).toEqual({ enabled: false, pollSeconds: 15 });
  expect(
    odooReturnConfig({
      RUTAS_ODOO_RETURNS_ENABLED: "true",
      RUTAS_ODOO_RETURNS_POLL_SECONDS: "10",
    }),
  ).toEqual({ enabled: true, pollSeconds: 10 });
  for (const flag of ["1", "yes"])
    expect(() =>
      odooReturnConfig({ RUTAS_ODOO_RETURNS_ENABLED: flag }),
    ).toThrow();
  for (const value of ["4", "3601", "NaN", "5.5"])
    expect(() =>
      odooReturnConfig({ RUTAS_ODOO_RETURNS_POLL_SECONDS: value }),
    ).toThrow();
});
