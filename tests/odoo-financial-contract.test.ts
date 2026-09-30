import { expect, it } from "vitest";
import {
  financialCapabilities,
  financialId,
  normalizeFinancialObservation,
  type FinancialRaw,
} from "../src/core/odoo-financial-contract";
import { financialObservation, financialTarget } from "./helpers/financial";
import { readFinancialSources } from "../src/core/odoo";

const stock = { quantity: { type: "float" }, uom_id: { relation: "uom.uom" } };
const sale = {
  product_uom_id: { relation: "uom.uom" },
  tax_ids: { relation: "account.tax" },
  currency_id: { relation: "res.currency" },
  write_date: { type: "datetime" },
  ...Object.fromEntries(
    [
      "product_uom_qty",
      "qty_delivered",
      "price_unit",
      "discount",
      "price_subtotal",
      "price_tax",
      "price_total",
    ].map((key) => [key, { type: "float" }]),
  ),
};
const caps = {
  quantityField: "quantity",
  unitField: "uom_id",
  saleUnitField: "product_uom_id",
  taxField: "tax_ids",
};
function raw(): FinancialRaw {
  const company_id = [1, "QA"],
    write_date = "2026-09-30 14:16:49";
  const picking = {
    id: 1,
    name: "OUT/QA",
    partner_id: [1, "QA"],
    state: "done",
    picking_type_code: "outgoing",
    location_dest_id: [5, "Customers"],
    date_done: write_date,
    write_date,
    company_id,
  };
  return {
    picking,
    pickings: [structuredClone(picking)],
    order: {
      id: 1,
      name: "QA",
      state: "sale",
      write_date,
      company_id,
      order_line: [10],
      currency_id: [1, "MXN"],
      amount_untaxed: 20,
      amount_tax: 0,
      amount_total: 20,
    },
    currency: { id: 1, name: "MXN", rounding: 0.01, decimal_places: 2 },
    locations: [{ id: 5, usage: "customer" }],
    saleLines: [
      {
        id: 10,
        name: "Producto",
        company_id,
        order_id: [1, "QA"],
        product_id: [2, "Producto"],
        display_type: false,
        product_uom_id: [3, "kg"],
        currency_id: [1, "MXN"],
        product_uom_qty: 2,
        qty_delivered: 2,
        price_unit: 10,
        discount: 0,
        tax_ids: [],
        price_subtotal: 20,
        price_tax: 0,
        price_total: 20,
        write_date,
      },
    ],
    moves: [
      {
        id: 100,
        company_id,
        sale_line_id: [10, "QA"],
        picking_id: [1, "OUT/QA"],
        product_id: [2, "Producto"],
        uom_id: [3, "kg"],
        product_uom_qty: 2,
        quantity: 2,
        state: "done",
        origin_returned_move_id: false,
        write_date,
      },
    ],
  };
}
it("normalizes the installed field names, decimals and stable identities without grouping by names", () => {
  expect(caps).toEqual({
    quantityField: "quantity",
    unitField: "uom_id",
    saleUnitField: "product_uom_id",
    taxField: "tax_ids",
  });
  expect(financialCapabilities(stock, sale)).toEqual(caps);
  expect(
    normalizeFinancialObservation(raw(), caps, financialTarget, 1),
  ).toEqual(financialObservation());
  const value = raw();
  value.saleLines.push({ ...value.saleLines[0], id: 11 });
  value.order.order_line = [11, 10];
  value.saleLines.reverse();
  value.saleLines[0].tax_ids = [9, 8];
  value.moves.push({
    ...value.moves[0],
    id: 101,
    sale_line_id: [11, "QA"],
    origin_returned_move_id: [99, "QA"],
  });
  value.moves.reverse();
  value.pickings.push({ ...value.pickings[0], id: 2 });
  value.pickings.reverse();
  const normalized = normalizeFinancialObservation(
    value,
    caps,
    financialTarget,
    1,
  );
  expect(normalized.saleLines.map((line) => line.id)).toEqual([10, 11]);
  expect(normalized.saleLines[1].taxIds).toEqual([8, 9]);
  expect(normalized.moves.map((move) => move.id)).toEqual([100, 101]);
  expect(normalized.moves[1].returnedMoveId).toBe(99);
  expect(normalized.relatedPickings.map((picking) => picking.id)).toEqual([
    1, 2,
  ]);
});
it("supports metadata-confirmed alternate names and tolerates nullable noncommercial/internal references", () => {
  const alternate = {
    ...sale,
    product_uom_id: {},
    tax_ids: {},
    product_uom: { relation: "uom.uom" },
    tax_id: { relation: "account.tax" },
  };
  expect(
    financialCapabilities(
      {
        quantity_done: { type: "float" },
        product_uom: { relation: "uom.uom" },
      },
      alternate,
    ),
  ).toEqual({
    quantityField: "quantity_done",
    unitField: "product_uom",
    saleUnitField: "product_uom",
    taxField: "tax_id",
  });
  const value = raw();
  Object.assign(value.saleLines[0], {
    display_type: "line_note",
    product_uom_id: false,
    product_id: false,
  });
  Object.assign(value.moves[0], { sale_line_id: false, picking_id: false });
  value.picking.date_done = false;
  value.picking.partner_id = false;
  const result = normalizeFinancialObservation(value, caps, financialTarget, 1);
  expect(result.saleLines[0]).toMatchObject({
    displayType: "line_note",
    productId: null,
    uomId: null,
    uom: null,
  });
  expect(result.moves[0]).toMatchObject({ saleLineId: null, pickingId: null });
  expect(result.picking).toMatchObject({ validatedAt: null, partnerId: null });
});
it.each([
  null,
  [],
  "text",
  {},
  { ...sale, product_uom_id: {} },
  { ...sale, tax_ids: {} },
  { ...sale, currency_id: {} },
  { ...sale, write_date: {} },
  { ...sale, price_total: {} },
])("rejects unsupported sale metadata %s", (value) => {
  expect(() => financialCapabilities(stock, value)).toThrow(
    "ODOO_FINANCIAL_SCHEMA_UNSUPPORTED",
  );
});
it("rejects unsupported stock metadata", () => {
  expect(() => financialCapabilities({}, sale)).toThrow(
    "ODOO_SCHEMA_UNSUPPORTED",
  );
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null, NaN])(
  "rejects invalid IDs %s",
  (value) => {
    expect(() => financialId(value)).toThrow("ODOO_FINANCIAL_INVALID_RESPONSE");
  },
);
const corruptions: [string, (value: FinancialRaw) => void][] = [
  [
    "picking",
    (v) => {
      v.picking.id = 9;
    },
  ],
  [
    "order",
    (v) => {
      v.order.id = 9;
    },
  ],
  [
    "missing line",
    (v) => {
      v.order.order_line = [10, 11];
    },
  ],
  [
    "duplicated line ids",
    (v) => {
      v.order.order_line = [10, 10];
    },
  ],
  [
    "not IDs",
    (v) => {
      v.order.order_line = false;
    },
  ],
  [
    "duplicate records",
    (v) => {
      v.moves.push(v.moves[0]);
    },
  ],
  [
    "relation missing",
    (v) => {
      v.picking.partner_id = null;
    },
  ],
  [
    "relation arity",
    (v) => {
      v.order.currency_id = [1];
    },
  ],
  [
    "relation type",
    (v) => {
      v.order.currency_id = [1, 4];
    },
  ],
  [
    "bad date",
    (v) => {
      v.picking.date_done = "not-date";
    },
  ],
  [
    "wrong sale",
    (v) => {
      v.saleLines[0].order_id = [2, "other"];
    },
  ],
  [
    "wrong currency",
    (v) => {
      v.currency.id = 3;
    },
  ],
  [
    "missing location",
    (v) => {
      v.locations = [];
    },
  ],
  [
    "zero rounding",
    (v) => {
      v.currency.rounding = 0;
    },
  ],
  [
    "negative rounding",
    (v) => {
      v.currency.rounding = -1;
    },
  ],
  [
    "decimal places text",
    (v) => {
      v.currency.decimal_places = "2";
    },
  ],
  [
    "decimal places fractional",
    (v) => {
      v.currency.decimal_places = 2.5;
    },
  ],
  [
    "decimal places negative",
    (v) => {
      v.currency.decimal_places = -1;
    },
  ],
  [
    "decimal places out of bounds",
    (v) => {
      v.currency.decimal_places = 25;
    },
  ],
];
it.each(corruptions)("rejects incomplete/invalid %s", (_name, change) => {
  const value = raw();
  change(value);
  expect(() =>
    normalizeFinancialObservation(value, caps, financialTarget, 1),
  ).toThrow("ODOO_FINANCIAL_INVALID_RESPONSE");
});
it.each(["picking", "order", "saleLines", "moves", "pickings"] as const)(
  "rejects another company in %s",
  (key) => {
    const value = raw();
    const row = Array.isArray(value[key]) ? value[key][0] : value[key];
    row.company_id = [2, "other"];
    expect(() =>
      normalizeFinancialObservation(value, caps, financialTarget, 1),
    ).toThrow("ODOO_COMPANY_DENIED");
  },
);
it("rejects other origins and bad IDs before contacting an external service", async () => {
  const config = {
    fingerprint: "local",
    url: "https://unused.invalid",
    database: "",
    username: "",
    credential: "",
    companyId: 1,
    timeoutMs: 1000,
    pickerNoteField: "",
    pickerNoteLabel: "",
  };
  expect(await readFinancialSources([], config)).toEqual([]);
  await expect(readFinancialSources([financialTarget], config)).rejects.toThrow(
    "ODOO_SOURCE_CHANGED",
  );
  await expect(
    readFinancialSources([{ ...financialTarget, pickingId: 0 }], config),
  ).rejects.toThrow("ODOO_FINANCIAL_INVALID_RESPONSE");
});

it("covers boundary and decimal metadata contracts directly", () => {
  expect(financialId(1)).toBe(1);
  const monetary = { ...sale, price_total: { type: "monetary" } };
  expect(financialCapabilities(stock, monetary)).toEqual(caps);
  const value = raw();
  value.picking.picking_type_code = "internal";
  value.locations[0].usage = "internal";
  expect(
    normalizeFinancialObservation(value, caps, financialTarget, 1).picking,
  ).toMatchObject({ outgoing: false, customerDestination: false });
  for (const places of [0, 24]) {
    value.currency.decimal_places = places;
    expect(
      normalizeFinancialObservation(value, caps, financialTarget, 1).currency
        .decimalPlaces,
    ).toBe(places);
  }
  value.saleLines[0].tax_ids = [1, 1];
  expect(() =>
    normalizeFinancialObservation(value, caps, financialTarget, 1),
  ).toThrow("ODOO_FINANCIAL_INVALID_RESPONSE");
});

it("returns explicit safe errors for missing metadata and oversized relations", () => {
  function check(action: () => unknown, code: string) {
    let caught: unknown;
    try {
      action();
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code, status: 502, message: code });
  }
  const missingCurrency = { ...sale } as Record<string, unknown>;
  delete missingCurrency.currency_id;
  const missingDate = { ...sale } as Record<string, unknown>;
  delete missingDate.write_date;
  for (const metadata of [
    missingCurrency,
    missingDate,
    Object.assign([], sale),
  ])
    check(
      () => financialCapabilities(stock, metadata),
      "ODOO_FINANCIAL_SCHEMA_UNSUPPORTED",
    );
  check(() => financialId(0), "ODOO_FINANCIAL_INVALID_RESPONSE");
  const value = raw();
  value.picking.partner_id = [1, "QA", "unexpected"];
  check(
    () => normalizeFinancialObservation(value, caps, financialTarget, 1),
    "ODOO_FINANCIAL_INVALID_RESPONSE",
  );
});
