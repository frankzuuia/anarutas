import { describe, expect, it } from "vitest";
import { stockMoveCapabilities } from "../src/core/odoo-capabilities";

describe("Odoo stock.move capability negotiation", () => {
  it("accepts the Odoo 17 quantity and unit metadata contract", () => {
    expect(
      stockMoveCapabilities({
        quantity: { type: "float" },
        product_uom: { type: "many2one", relation: "uom.uom" },
      }),
    ).toEqual({ quantityField: "quantity", unitField: "product_uom" });
  });

  it("accepts the SaaS 19.4 quantity and unit metadata contract", () => {
    expect(
      stockMoveCapabilities({
        quantity: { type: "float" },
        uom_id: { type: "many2one", relation: "uom.uom" },
      }),
    ).toEqual({ quantityField: "quantity", unitField: "uom_id" });
  });

  it("supports the legacy completed quantity fallback and fails closed", () => {
    expect(
      stockMoveCapabilities({
        quantity_done: { type: "float" },
        product_uom: { relation: "uom.uom" },
      }),
    ).toEqual({
      quantityField: "quantity_done",
      unitField: "product_uom",
    });
    for (const value of [
      null,
      1,
      "fields",
      [],
      {},
      { quantity: { type: "char" } },
      { quantity: { type: "float" } },
      { product_uom: { relation: "uom.uom" } },
    ])
      expect(() => stockMoveCapabilities(value)).toThrow(
        "ODOO_SCHEMA_UNSUPPORTED",
      );
  });
});
