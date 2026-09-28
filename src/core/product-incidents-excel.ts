import ExcelJS from "exceljs";
import type { ProductIncident } from "./product-incidents";
import { productIncidentDetail } from "./product-incidents-policy";
import { excelText } from "./excel";

export async function productIncidentsWorkbook(rows: ProductIncident[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ana Rutas";
  const sheet = workbook.addWorksheet("Incidencias");
  const columns = ["Fecha", "Cliente", "Producto", "Cantidad", "Unidad", "Departamento", "Detalle de la incidencia", "Comentarios", "Orden"];
  sheet.addTable({ name: "Incidencias", ref: "A1", headerRow: true, totalsRow: false,
    style: { theme: "TableStyleMedium4", showRowStripes: true },
    columns: columns.map(name => ({ name, filterButton: true })),
    rows: rows.map(row => [new Date(`${row.date}T00:00:00Z`), excelText(row.snapshot.customer), excelText(row.product),
      // Excel only stores 15 significant digits; keep unusually large precise quantities as text.
      row.quantity.replace(".", "").replace(/^0+/u, "").replace(/0+$/u, "").length > 15
        ? row.quantity : Number(row.quantity),
      excelText(row.unit), excelText(row.department), productIncidentDetail(row.kind, row.warehouseReason),
      excelText(row.note), excelText(row.orderName)]),
  });
  [14, 35, 38, 14, 12, 20, 34, 55, 18].forEach((width, i) => { sheet.getColumn(i + 1).width = width; });
  sheet.getColumn(1).numFmt = "dd/mm/yyyy";
  sheet.getColumn(4).numFmt = "0.00####";
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.eachRow(row => { row.alignment = { vertical: "top", wrapText: true }; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
