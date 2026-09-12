import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { candidateConfig } from "../src/core/order-candidates-config";
import {
  fulfillmentStatus,
  lifecycleUpdate,
  parseSelection,
  resolveSelection,
  routingCapabilities,
  routingDateEligible,
} from "../src/core/order-candidates-validation";
import { importRange } from "../src/core/orders-validation";
import { localShipment } from "./helpers/candidate";
describe("candidate eligibility and selection", () => {
  it("accepts only approved picking states", () => {
    expect(fulfillmentStatus("done")).toBe("validated");
    for (const state of ["confirmed", "assigned"])
      expect(fulfillmentStatus(state)).toBe("pending_validation");
    for (const state of [
      "waiting",
      "cancel",
      "draft",
      "partially_available",
      null,
      undefined,
      "",
    ])
      expect(() => fulfillmentStatus(state)).toThrow("CANDIDATE_CHANGED");
  });
  it("negotiates actual 17/19 field shapes without version branching", () => {
    const p = {
      date_done: { type: "datetime" },
      scheduled_date: { type: "datetime" },
      write_date: { type: "datetime" },
      state: {
        selection: [
          ["done", ""],
          ["confirmed", ""],
          ["assigned", ""],
        ],
      },
      return_id: { relation: "stock.picking" },
    };
    const m = {
      quantity: { type: "float" },
      product_uom_qty: { type: "float" },
      product_uom: { relation: "uom.uom" },
      sale_line_id: { relation: "sale.order.line" },
      origin_returned_move_id: { relation: "stock.move" },
    };
    const s = {
      state: {
        selection: [
          ["sale", ""],
          ["done", ""],
          ["draft", ""],
        ],
      },
    };
    expect(routingCapabilities(p, m, s)).toEqual({
      quantityField: "quantity",
      unitField: "product_uom",
      demandField: "product_uom_qty",
      saleStates: ["sale", "done"],
      returnField: "return_id",
    });
    expect(
      routingCapabilities(
        { ...p, return_id: undefined },
        { ...m, product_uom: undefined, uom_id: { relation: "uom.uom" } },
        s,
      ),
    ).toMatchObject({ unitField: "uom_id", returnField: null });
    for (const field of ["date_done", "scheduled_date", "write_date", "state"])
      expect(() =>
        routingCapabilities({ ...p, [field]: undefined }, m, s),
      ).toThrow("ODOO_SCHEMA_UNSUPPORTED");
    for (const field of [
      "product_uom_qty",
      "sale_line_id",
      "origin_returned_move_id",
    ])
      expect(() =>
        routingCapabilities(p, { ...m, [field]: undefined }, s),
      ).toThrow("ODOO_SCHEMA_UNSUPPORTED");
    for (const invalid of [null, {}, { state: { selection: [] } }])
      expect(() => routingCapabilities(p, m, invalid)).toThrow(
        "ODOO_SCHEMA_UNSUPPORTED",
      );
    for (const invalid of [null, undefined])
      expect(() => routingCapabilities(invalid, m, s)).toThrow(
        "ODOO_SCHEMA_UNSUPPORTED",
      );
    for (const invalid of [null, undefined])
      expect(() => routingCapabilities(p, invalid, s)).toThrow(
        "ODOO_SCHEMA_UNSUPPORTED",
      );
    for (const states of [
      [["done", ""]],
      [["confirmed", ""]],
      [["assigned", ""]],
      [
        ["done", ""],
        ["confirmed", ""],
      ],
    ])
      expect(() =>
        routingCapabilities({ ...p, state: { selection: states } }, m, s),
      ).toThrow("ODOO_SCHEMA_UNSUPPORTED");
  });
  it("uses date by state with exact inclusive/exclusive local boundaries", () => {
    const range = importRange(
      { from: "2026-09-11", to: "2026-09-11" },
      "America/Mexico_City",
    );
    const s = localShipment();
    expect(routingDateEligible(s, range)).toBe(true);
    for (const date of [
      null,
      "bad",
      "2026-09-11T05:59:59Z",
      "2026-09-12T06:00:00Z",
    ])
      expect(routingDateEligible({ ...s, scheduledAt: date }, range)).toBe(
        false,
      );
    for (const date of ["2026-09-11T06:00:00Z", "2026-09-12T05:59:59Z"])
      expect(routingDateEligible({ ...s, scheduledAt: date }, range)).toBe(
        true,
      );
    expect(
      routingDateEligible(
        { ...s, fulfillmentStatus: "validated", validatedAt: null },
        range,
      ),
    ).toBe(false);
    expect(
      routingDateEligible(
        {
          ...s,
          fulfillmentStatus: "validated",
          validatedAt: "2026-09-11T06:00:00Z",
          scheduledAt: null,
        },
        range,
      ),
    ).toBe(true);
    const dst = importRange(
      { from: "2026-03-08", to: "2026-03-08" },
      "America/New_York",
    );
    expect(
      (Date.parse(dst.end + "Z") - Date.parse(dst.start + "Z")) / 3600000,
    ).toBe(23);
  });
  it("resolves explicit/all-except across all pages; unknown/duplicate ids fail", () => {
    const cs = Array.from({ length: 120 }, () => ({
      candidateId: randomUUID(),
    }));
    expect(
      resolveSelection(cs, { mode: "all_except", ids: [cs[55].candidateId] }),
    ).toHaveLength(119);
    expect(
      resolveSelection(cs, { mode: "explicit", ids: [cs[55].candidateId] }),
    ).toEqual([cs[55]]);
    expect(
      parseSelection({
        mode: "explicit",
        ids: [cs[1].candidateId, cs[0].candidateId],
      }).ids,
    ).toEqual([cs[1].candidateId, cs[0].candidateId].sort());
    for (const invalid of [
      null,
      [],
      {},
      { mode: "other", ids: [] },
      { mode: "explicit", ids: 1 },
      { mode: "explicit", ids: ["invalid"] },
      { mode: "explicit", ids: [cs[0].candidateId, cs[0].candidateId] },
    ])
      expect(() => parseSelection(invalid)).toThrow();
    for (const mode of ["explicit", "all_except"] as const)
      expect(() => resolveSelection(cs, { mode, ids: [randomUUID()] })).toThrow(
        "CANDIDATE_INVALID",
      );
    expect(() => resolveSelection(cs, { mode: "explicit", ids: [] })).toThrow(
      "SELECTION_EMPTY",
    );
    expect(() =>
      resolveSelection(cs, {
        mode: "all_except",
        ids: cs.map((c) => c.candidateId),
      }),
    ).toThrow("SELECTION_EMPTY");
    const descending = [
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      "00000000-0000-4000-8000-000000000000",
    ];
    expect(parseSelection({ mode: "explicit", ids: descending }).ids).toEqual(
      [...descending].sort(),
    );
    for (const invalid of [
      null,
      [],
      7,
      "invalid",
      {},
      { mode: "other", ids: [] },
    ]) {
      try {
        parseSelection(invalid);
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toMatchObject({ code: "INVALID_INPUT" });
      }
    }
  });
  it("updates lifecycle only and rejects identity changes/regression", () => {
    const s = localShipment(),
      next = {
        ...s,
        odooPickingState: "done",
        fulfillmentStatus: "validated" as const,
        validatedAt: s.scheduledAt,
        customerName: "External changed",
        address: "External changed",
      };
    const updated = lifecycleUpdate(s, next);
    expect(updated).toEqual({
      ...next,
      customerName: s.customerName,
      address: s.address,
    });
    for (const field of ["pickingId", "orderId", "partnerId"])
      expect(() => lifecycleUpdate(s, { ...next, [field]: 99 })).toThrow(
        "CANDIDATE_CHANGED",
      );
    expect(() => lifecycleUpdate(updated, s)).toThrow("CANDIDATE_CHANGED");
    expect(lifecycleUpdate(updated, updated)).toEqual(updated);
    expect(lifecycleUpdate(s, s)).toEqual(s);
    const historical = { ...updated };
    delete (historical as Partial<typeof historical>).fulfillmentStatus;
    expect(() => lifecycleUpdate(historical, s)).toThrow("CANDIDATE_CHANGED");
  });
  it("requires positive technical limits; defaults and runtime values", () => {
    expect(candidateConfig({})).toMatchObject({
      ttlSeconds: 1800,
      maxCandidates: 5000,
    });
    for (const key of [
      "RUTAS_ORDER_BATCH_TTL_SECONDS",
      "RUTAS_ORDER_RECEIPT_TTL_SECONDS",
      "RUTAS_ORDER_MAX_CANDIDATES",
      "RUTAS_ORDER_QUERY_TIMEOUT_MS",
      "RUTAS_ORDER_REQUESTS_PER_MINUTE",
    ]) {
      for (const value of ["0", "-1", "nan", "1.2"])
        expect(() => candidateConfig({ [key]: value })).toThrow(
          "CONFIG_INVALID",
        );
      expect(Object.values(candidateConfig({ [key]: "7" }))).toContain(7);
      expect(candidateConfig({ [key]: "" })).toEqual(candidateConfig({}));
    }
  });
});
