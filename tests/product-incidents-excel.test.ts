import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { ProductIncident } from "../src/core/product-incidents";
import { productIncidentsWorkbook } from "../src/core/product-incidents-excel";

it("exports exactly nine columns, edited department, numeric quantities, no driver or concept, and safe text", async () => {
  const row = { date: "2026-09-28", snapshot: { customer: "Cliente A", driver: "PRIVATE DRIVER" },
    product: "Queso", quantity: "0.250000", unit: "kg", department: "Compras", concept: "PRIVATE CONCEPT",
    kind: "replacement_quality", warehouseReason: null, note: "No cumple calidad", orderName: "S0087" } as ProductIncident;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await productIncidentsWorkbook([row, { ...row, kind: "shortage_warehouse", warehouseReason: "late_arrival",
    product: "=1+2", quantity: "999999999999.999999", note: "@SUM(1,2)", orderName: "+malicious" }]) as never);
  const sheet = book.getWorksheet("Incidencias")!;
  expect(sheet.columnCount).toBe(9);
  expect(sheet.getRow(1).values).toEqual([undefined, "Fecha", "Cliente", "Producto", "Cantidad", "Unidad", "Departamento", "Detalle de la incidencia", "Comentarios", "Orden"]);
  expect(sheet.getRow(2).values).toEqual([undefined, new Date("2026-09-28T00:00:00Z"), "Cliente A", "Queso", 0.25, "kg", "Compras", "Calidad", "No cumple calidad", "S0087"]);
  expect(sheet.getCell("C3").value).toBe("'=1+2");
  expect(sheet.getCell("D3").value).toBe("999999999999.999999");
  expect(sheet.getCell("G3").value).toBe("Llegada tardía");
  expect(sheet.getCell("H3").value).toBe("'@SUM(1,2)");
  expect(sheet.getCell("I3").value).toBe("'+malicious");
  expect(JSON.stringify(sheet.model)).not.toContain("PRIVATE");
  expect(sheet.getTable("Incidencias")).toBeTruthy();
  expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
});

it("exports a readable empty table without inventing incidents", async () => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await productIncidentsWorkbook([]) as never);
  expect(book.getWorksheet("Incidencias")!.rowCount).toBe(1);
});
