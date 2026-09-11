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
    expect(workbook.getWorksheet("Ruta")!.getCell("P2").text).toBe("");

    const vehicleId = "00000000-0000-4000-8000-000000000005";
    const assigned: OrderBoard = {
      ...board,
      vehicles: [
        {
          id: vehicleId,
          name: "Camioneta QA",
          brand: "Ford",
          model: "2026",
          plate: "QA-1",
          mileage: "0",
          fuel: "Gasolina",
          available: true,
          driver_id: null,
          driver_name: null,
          version: 1,
        },
      ],
      shipments: [{ ...board.shipments[0], vehicle_id: vehicleId }],
    };
    const optimized = await planWorkbook(
      assigned,
      {
        runId: "00000000-0000-4000-8000-000000000006",
        planId: board.plan.id,
        appliedPlanVersion: board.plan.version,
        current: true,
        createdAt: "2026-09-09T12:00:00Z",
        metrics: {
          travelDistanceMeters: 12500,
          travelDurationSeconds: 1800,
          waitDurationSeconds: 0,
          totalDurationSeconds: 1800,
          performedShipmentCount: 1,
        },
        skipped: [],
        routes: [
          {
            vehicleId,
            vehicleName: "Camioneta QA",
            encodedPolyline: null,
            departureAt: "2026-09-09T08:00:00Z",
            finishedAt: "2026-09-09T08:30:00Z",
            metrics: {
              travelDistanceMeters: 12500,
              travelDurationSeconds: 1800,
              waitDurationSeconds: 0,
              totalDurationSeconds: 1800,
              performedShipmentCount: 1,
            },
            stops: [
              {
                shipmentId: board.shipments[0].id,
                position: 1,
                eta: "2026-09-09T08:12:00Z",
                travelDistanceMeters: 4500,
                travelDurationSeconds: 720,
                waitDurationSeconds: 0,
              },
            ],
          },
        ],
      },
      "UTC",
    );
    const optimizedWorkbook = new ExcelJS.Workbook();
    await optimizedWorkbook.xlsx.load(optimized as never);
    const optimizedRoute = optimizedWorkbook.getWorksheet("Ruta")!;
    expect(optimizedRoute.getCell("P2").text).toBe("08:00");
    expect(optimizedRoute.getCell("Q2").text).toBe("08:12");
    expect(optimizedRoute.getCell("R2").text).toBe("08:30");
    expect(optimizedRoute.getCell("S2").value).toBe(4.5);
    expect(optimizedRoute.getCell("T2").value).toBe(12.5);
  });
});
