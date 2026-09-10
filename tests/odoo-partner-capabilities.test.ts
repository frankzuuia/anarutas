import { describe, expect, it } from "vitest";
import { partnerCapabilities } from "../src/core/odoo-partner-capabilities";

describe("Odoo partner capability negotiation", () => {
  it("requests mobile only when the running Odoo exposes it", () => {
    const v17 = partnerCapabilities({
      id: { type: "integer" },
      name: { type: "char" },
      company_id: { type: "many2one" },
      phone: { type: "char" },
      mobile: { type: "char" },
      parent_id: { type: "many2one" },
    });
    const v19WithoutMobile = partnerCapabilities({
      id: { type: "integer" },
      name: { type: "char" },
      company_id: { type: "many2one" },
      phone: { type: "char" },
    });
    expect(v17.fields).toContain("mobile");
    expect(v19WithoutMobile.fields).not.toContain("mobile");
    expect(v19WithoutMobile.fields).toEqual([
      "id",
      "name",
      "company_id",
      "phone",
    ]);
    expect(v17.has("mobile")).toBe(true);
    expect(v19WithoutMobile.has("mobile")).toBe(false);
    v19WithoutMobile.fields.push("mobile");
    expect(v19WithoutMobile.has("mobile")).toBe(false);
  });

  it("fails closed when stable identity or company scope is unavailable", () => {
    for (const value of [null, [], "metadata", 19])
      expect(() => partnerCapabilities(value)).toThrowError(
        expect.objectContaining({
          code: "ODOO_SCHEMA_UNSUPPORTED",
          status: 502,
        }),
      );
    for (const required of ["id", "name", "company_id"] as const) {
      const valid: Record<string, unknown> = {
        id: {},
        name: {},
        company_id: {},
      };
      delete valid[required];
      expect(() => partnerCapabilities(valid)).toThrowError(
        expect.objectContaining({
          code: "ODOO_SCHEMA_UNSUPPORTED",
          status: 502,
        }),
      );
      valid[required] = "not metadata";
      expect(() => partnerCapabilities(valid)).toThrowError(
        expect.objectContaining({
          code: "ODOO_SCHEMA_UNSUPPORTED",
          status: 502,
        }),
      );
    }
  });

  it("ignores unknown and malformed optional fields while preserving candidate order", () => {
    const result = partnerCapabilities({
      mobile: "not metadata",
      company_id: {},
      name: {},
      id: {},
      street: {},
      unknown_field: {},
    });
    expect(result.fields).toEqual(["id", "name", "company_id", "street"]);
    expect(result.has("street")).toBe(true);
    expect(result.has("mobile")).toBe(false);
  });
});
