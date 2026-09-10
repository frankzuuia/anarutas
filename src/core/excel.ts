import ExcelJS from "exceljs";
import type { Customer } from "./customers-contract";
import type { OrderBoard } from "./orders-contract";

const green = "FF16D98A";
const dark = "FF0B1711";
const pale = "FFE6FFF3";
const days = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function excelText(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /^[=+\-@]/u.test(text.trimStart()) ? `'${text}` : text;
}

export function minuteText(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function prepareSheet(
  sheet: ExcelJS.Worksheet,
  columns: { header: string; key: string; width: number }[],
) {
  sheet.columns = columns;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: "A1",
    to: `${sheet.getColumn(columns.length).letter}1`,
  };
  const header = sheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: dark } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: green } };
  header.alignment = { vertical: "middle" };
  sheet.eachRow((row, index) => {
    if (index > 1 && index % 2 === 0)
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: pale } };
    row.alignment = { vertical: "top", wrapText: true };
  });
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
}

function priorityLabel(priority: Customer["priority"]) {
  return priority === "high"
    ? "Alta"
    : priority === "medium"
      ? "Media"
      : "Por horario";
}

function typeLabel(customer: Customer) {
  if (customer.odooIsCompany) return "Matriz / empresa";
  if (customer.odooType === "delivery") return "Dirección de entrega";
  if (customer.odooType === "invoice") return "Dirección de facturación";
  return customer.odooParentId ? "Sucursal / contacto" : "Contacto";
}

async function buffer(workbook: ExcelJS.Workbook) {
  workbook.creator = "Ana Rutas";
  workbook.lastModifiedBy = "Ana Rutas";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = false;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function customerWorkbook(customers: Customer[]) {
  const workbook = new ExcelJS.Workbook();
  const clients = workbook.addWorksheet("Clientes", {
    properties: { tabColor: { argb: green } },
  });
  clients.columns = [
    { header: "ID Odoo", key: "odooId", width: 12 },
    { header: "Cliente", key: "client", width: 30 },
    { header: "Nombre en Odoo", key: "odooName", width: 30 },
    { header: "Tipo", key: "type", width: 22 },
    { header: "Matriz", key: "parent", width: 28 },
    { header: "Teléfono operativo", key: "phone", width: 20 },
    { header: "Teléfono Odoo", key: "odooPhone", width: 20 },
    { header: "Móvil Odoo", key: "odooMobile", width: 20 },
    { header: "Prioridad", key: "priority", width: 16 },
    { header: "Modalidad", key: "mode", width: 14 },
    { header: "Nota de entrega", key: "note", width: 38 },
    { header: "Domicilio de entrega", key: "address", width: 48 },
    { header: "Domicilio Odoo", key: "odooAddress", width: 48 },
    { header: "Liga Maps", key: "map", width: 45 },
    { header: "Latitud", key: "lat", width: 14 },
    { header: "Longitud", key: "lng", width: 14 },
    { header: "Estado del punto", key: "location", width: 20 },
    { header: "Activo en Odoo", key: "odooActive", width: 16 },
    { header: "Estado local", key: "localState", width: 14 },
  ];
  for (const customer of customers)
    clients.addRow({
      odooId: customer.odooPartnerId,
      client: excelText(customer.displayName),
      odooName: excelText(customer.odooName),
      type: typeLabel(customer),
      parent: excelText(customer.parentName || customer.commercialName),
      phone: excelText(customer.phone),
      odooPhone: excelText(customer.odooPhone),
      odooMobile: excelText(customer.odooMobile),
      priority: priorityLabel(customer.priority),
      mode: customer.fulfillmentMode === "pickup" ? "Recoge" : "Entrega",
      note: excelText(customer.deliveryNote),
      address: excelText(customer.deliveryAddress),
      odooAddress: excelText(customer.odooAddress),
      map: excelText(customer.mapUrl),
      lat: customer.latitude,
      lng: customer.longitude,
      location:
        customer.locationStatus === "confirmed"
          ? "Confirmado"
          : customer.locationStatus === "driver_confirmed"
            ? "Confirmado por chofer"
            : "Punto por confirmar",
      odooActive: customer.odooActive ? "Sí" : "No",
      localState: customer.archivedAt ? "Archivado" : "Activo",
    });
  prepareSheet(clients, clients.columns as never);

  const windows = workbook.addWorksheet("Ventanas");
  windows.columns = [
    { header: "ID Odoo", key: "odooId", width: 12 },
    { header: "Cliente", key: "client", width: 32 },
    { header: "Días", key: "days", width: 28 },
    { header: "Desde (24 h)", key: "start", width: 16 },
    { header: "Hasta (24 h)", key: "end", width: 16 },
    { header: "Orden", key: "position", width: 10 },
  ];
  for (const customer of customers)
    for (const window of customer.windows)
      windows.addRow({
        odooId: customer.odooPartnerId,
        client: excelText(customer.displayName),
        days: window.days.map((day) => days[day]).join(", "),
        start: minuteText(window.startMinute),
        end: minuteText(window.endMinute),
        position: window.position,
      });
  prepareSheet(windows, windows.columns as never);
  return buffer(workbook);
}

export async function planWorkbook(board: OrderBoard) {
  const workbook = new ExcelJS.Workbook();
  const route = workbook.addWorksheet("Ruta", {
    properties: { tabColor: { argb: green } },
  });
  route.columns = [
    { header: "Fecha", key: "date", width: 14 },
    { header: "Versión", key: "version", width: 10 },
    { header: "Camioneta", key: "vehicle", width: 24 },
    { header: "Chofer", key: "driver", width: 24 },
    { header: "Parada", key: "stop", width: 10 },
    { header: "Cliente", key: "customer", width: 30 },
    { header: "Pedido", key: "order", width: 16 },
    { header: "Surtido", key: "picking", width: 18 },
    { header: "Teléfono", key: "phone", width: 20 },
    { header: "Ventana (24 h)", key: "window", width: 24 },
    { header: "Prioridad", key: "priority", width: 16 },
    { header: "Domicilio", key: "address", width: 48 },
    { header: "Liga Maps", key: "map", width: 45 },
    { header: "Nota de entrega", key: "note", width: 38 },
    { header: "Modalidad", key: "mode", width: 14 },
  ];
  const stops = new Map<string, number>();
  for (const shipment of board.shipments) {
    const lane = shipment.vehicle_id || "unassigned";
    const stop = (stops.get(lane) || 0) + 1;
    stops.set(lane, stop);
    const vehicle = board.vehicles.find(
      (item) => item.id === shipment.vehicle_id,
    );
    route.addRow({
      date: board.plan.service_date,
      version: board.plan.version,
      vehicle: excelText(vehicle?.name || "Sin asignar"),
      driver: excelText(vehicle?.driver_name || ""),
      stop,
      customer: excelText(shipment.customerName),
      order: excelText(shipment.orderName),
      picking: excelText(shipment.pickingName),
      phone: excelText(shipment.phone),
      window: shipment.deliveryWindows
        .map(
          (item) =>
            `${minuteText(item.startMinute)}–${minuteText(item.endMinute)}`,
        )
        .join(" / "),
      priority:
        shipment.priority === "high"
          ? "Alta"
          : shipment.priority === "medium"
            ? "Media"
            : "Por horario",
      address: excelText(shipment.address),
      map: excelText(shipment.mapUrl),
      note: excelText(shipment.deliveryNote),
      mode: shipment.fulfillmentMode === "pickup" ? "Recoge" : "Entrega",
    });
  }
  prepareSheet(route, route.columns as never);

  const lines = workbook.addWorksheet("Partidas");
  lines.columns = [
    { header: "Pedido", key: "order", width: 16 },
    { header: "Surtido", key: "picking", width: 18 },
    { header: "Cliente", key: "customer", width: 30 },
    { header: "Producto", key: "product", width: 42 },
    { header: "Cantidad", key: "quantity", width: 14 },
    { header: "Unidad", key: "unit", width: 14 },
    { header: "Nota para picker", key: "pickerNote", width: 42 },
  ];
  for (const shipment of board.shipments)
    for (const line of shipment.lines)
      lines.addRow({
        order: excelText(shipment.orderName),
        picking: excelText(shipment.pickingName),
        customer: excelText(shipment.customerName),
        product: excelText(line.name),
        quantity: line.quantity,
        unit: excelText(line.unit),
        pickerNote: excelText(line.pickerNote),
      });
  prepareSheet(lines, lines.columns as never);
  return buffer(workbook);
}

export function safeFilePart(value: string) {
  const clean = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return clean || "exportacion";
}
