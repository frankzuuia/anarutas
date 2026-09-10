import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  customerWorkbook,
  excelText,
  minuteText,
  planWorkbook,
} from "../src/core/excel";
import type { OrderBoard } from "../src/core/orders-contract";
import type { Customer } from "../src/core/customers-contract";

const customer: Customer = {
  id: "00000000-0000-4000-8000-000000000001",
  odooPartnerId: 1,
  odooParentId: null,
  odooCommercialPartnerId: 1,
  odooType: "contact",
  odooIsCompany: true,
  odooActive: true,
  odooName: "Cliente Odoo",
  odooRef: null,
  odooPhone: null,
  odooMobile: null,
  odooAddress: "Domicilio Odoo",
  parentName: null,
  commercialName: null,
  displayName: '=HYPERLINK("bad")',
  phone: "+3312345678",
  deliveryNote: "@malicious",
  priority: "schedule",
  fulfillmentMode: "delivery",
  deliveryAddress: "-Domicilio",
  mapUrl: "https://www.google.com/maps/search/?api=1&query=20%2C-103",
  latitude: 20,
  longitude: -103,
  placeId: null,
  locationStatus: "confirmed",
  locationVersion: 1,
  archivedAt: null,
  version: 1,
  windows: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      days: [0, 1, 2, 3, 4],
      startMinute: 660,
      endMinute: 780,
      position: 1,
    },
  ],
};

describe("Excel exports", () => {
  it("neutralizes formula-like text and emits 24-hour times", () => {
    expect(excelText("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(excelText("+3312345678")).toBe("'+3312345678");
    expect(minuteText(660)).toBe("11:00");
    expect(minuteText(780)).toBe("13:00");
  });

  it("creates a readable workbook with Clientes and Ventanas", async () => {
    const output = await customerWorkbook([customer]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Clientes",
      "Ventanas",
    ]);
    expect(workbook.getWorksheet("Clientes")!.getCell("B2").text).toBe(
      '\'=HYPERLINK("bad")',
    );
    expect(workbook.getWorksheet("Ventanas")!.getCell("D2").text).toBe("11:00");
    expect(workbook.getWorksheet("Ventanas")!.getCell("E2").text).toBe("13:00");
  });

  it("exports one consistent plan with Ruta and Partidas", async () => {
    const board: OrderBoard = {
      plan: {
        id: "00000000-0000-4000-8000-000000000003",
        service_date: "2026-09-09",
        label: "Ruta QA",
        version: 7,
        updated_at: "2026-09-09T12:00:00.000Z",
      },
      vehicles: [],
      shipments: [
        {
          id: "00000000-0000-4000-8000-000000000004",
          pickingId: 1,
          pickingName: "WH/OUT/1",
          orderId: 1,
          orderName: "S00001",
          partnerId: 1,
          customerName: "Cliente QA",
          address: "Guadalajara",
          validatedAt: "2026-09-09T12:00:00.000Z",
          promisedAt: null,
          backorderId: null,
          lines: [
            {
              moveId: 1,
              productId: 1,
              name: "Producto QA",
              quantity: 3,
              unit: "kg",
              pickerNote: "=NO_EJECUTAR()",
            },
          ],
          vehicle_id: null,
          position: 1,
          window_start: "11:00:00",
          window_end: "13:00:00",
          high_priority: null,
          priority: "medium",
          deliveryWindows: [{ startMinute: 660, endMinute: 780 }],
          deliveryNote: "+tocar timbre",
          phone: null,
          fulfillmentMode: "delivery",
          mapUrl: null,
          latitude: null,
          longitude: null,
          locationStatus: "pending",
          customerArchived: false,
        },
      ],
    };
    const output = await planWorkbook(board);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Ruta",
      "Partidas",
    ]);
    expect(workbook.getWorksheet("Ruta")!.getCell("J2").text).toBe(
      "11:00–13:00",
    );
    expect(workbook.getWorksheet("Partidas")!.getCell("G2").text).toBe(
      "'=NO_EJECUTAR()",
    );
  });
});
