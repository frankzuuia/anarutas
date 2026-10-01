import { AppError } from "./errors";
import { stockMoveCapabilities } from "./odoo-capabilities";
import type {
  FinancialObservation,
  FinancialPicking,
  FinancialTarget,
} from "./financial-contract";
import { financialDecimal, FinancialDecimal } from "./financial-values";

type Row = Record<string, unknown>;
type Metadata = Record<string, { type?: string; relation?: string }>;
function schemaError() {
  return new AppError("ODOO_FINANCIAL_SCHEMA_UNSUPPORTED", 502);
}
export function financialCapabilities(stock: unknown, sale: unknown) {
  if (!sale || typeof sale !== "object" || Array.isArray(sale))
    throw schemaError();
  const fields = sale as Metadata;
  const saleUnitField = ["product_uom_id", "product_uom"].find(
    (name) => fields[name]?.relation === "uom.uom",
  );
  const taxField = ["tax_ids", "tax_id"].find(
    (name) => fields[name]?.relation === "account.tax",
  );
  for (const name of [
    "product_uom_qty",
    "qty_delivered",
    "price_unit",
    "discount",
    "price_subtotal",
    "price_tax",
    "price_total",
  ])
    if (!["float", "monetary"].includes(fields[name]?.type ?? ""))
      throw schemaError();
  if (
    !saleUnitField ||
    !taxField ||
    fields.currency_id?.relation !== "res.currency" ||
    fields.write_date?.type !== "datetime"
  )
    throw schemaError();
  return { ...stockMoveCapabilities(stock), saleUnitField, taxField };
}
export type FinancialCapabilities = ReturnType<typeof financialCapabilities>;
export type FinancialRaw = {
  picking: Row;
  order: Row;
  saleLines: Row[];
  moves: Row[];
  pickings: Row[];
  currency: Row;
  locations: Row[];
};
function invalid() {
  return new AppError("ODOO_FINANCIAL_INVALID_RESPONSE", 502);
}
export function financialId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw invalid();
  return value;
}
function ids(value: unknown): number[] {
  if (!Array.isArray(value)) throw invalid();
  const result = value.map(financialId);
  if (new Set(result).size !== result.length) throw invalid();
  return result.sort((a, b) => a - b);
}
function text(value: unknown): string {
  if (typeof value !== "string") throw invalid();
  return value;
}
function relation(value: unknown): [number, string] {
  if (!Array.isArray(value) || value.length !== 2) throw invalid();
  return [financialId(value[0]), text(value[1])];
}
function nullableRelation(value: unknown) {
  return value === false ? null : relation(value);
}
function date(value: unknown) {
  const raw = text(value);
  const parsed = new Date(raw.replace(" ", "T") + "Z");
  if (!Number.isFinite(parsed.getTime())) throw invalid();
  return parsed.toISOString();
}
function amounts(row: Row, prefix: "price" | "amount") {
  return {
    untaxed: financialDecimal(
      row[prefix === "price" ? "price_subtotal" : "amount_untaxed"],
    ),
    tax: financialDecimal(row[`${prefix}_tax`]),
    total: financialDecimal(row[`${prefix}_total`]),
  };
}
function assertCompany(rows: Row[], companyId: number) {
  if (rows.some((row) => relation(row.company_id)[0] !== companyId))
    throw new AppError("ODOO_COMPANY_DENIED", 403);
}
function uniqueRows(rows: Row[]) {
  const rowIds = rows.map((row) => financialId(row.id));
  if (new Set(rowIds).size !== rowIds.length) throw invalid();
}
export function normalizeFinancialObservation(
  raw: FinancialRaw,
  caps: FinancialCapabilities,
  target: FinancialTarget,
  companyId: number,
): FinancialObservation {
  for (const rows of [raw.saleLines, raw.moves, raw.pickings, raw.locations])
    uniqueRows(rows);
  assertCompany(
    [raw.picking, raw.order, ...raw.saleLines, ...raw.moves, ...raw.pickings],
    companyId,
  );
  if (
    financialId(raw.picking.id) !== target.pickingId ||
    financialId(raw.order.id) !== target.orderId
  )
    throw invalid();
  if (
    JSON.stringify(ids(raw.order.order_line)) !==
    JSON.stringify(
      raw.saleLines.map((row) => financialId(row.id)).sort((a, b) => a - b),
    )
  )
    throw invalid();
  const locations = new Map(
    raw.locations.map((row) => [financialId(row.id), text(row.usage)]),
  );
  function picking(row: Row): FinancialPicking {
    const destination = locations.get(relation(row.location_dest_id)[0]);
    if (!destination) throw invalid();
    return {
      id: financialId(row.id),
      name: text(row.name),
      partnerId: nullableRelation(row.partner_id)?.[0] ?? null,
      state: text(row.state),
      outgoing: row.picking_type_code === "outgoing",
      customerDestination: destination === "customer",
      validatedAt: row.date_done === false ? null : date(row.date_done),
      writeDate: date(row.write_date),
    };
  }
  const rounding = financialDecimal(raw.currency.rounding);
  const decimalPlaces = raw.currency.decimal_places;
  if (
    new FinancialDecimal(rounding).lte(0) ||
    typeof decimalPlaces !== "number" ||
    !Number.isInteger(decimalPlaces) ||
    decimalPlaces < 0 ||
    decimalPlaces > 24
  )
    throw invalid();
  const currencyId = financialId(raw.currency.id);
  if (relation(raw.order.currency_id)[0] !== currencyId) throw invalid();
  return {
    companyId,
    picking: picking(raw.picking),
    order: {
      id: financialId(raw.order.id),
      name: text(raw.order.name),
      state: text(raw.order.state),
      writeDate: date(raw.order.write_date),
      amounts: amounts(raw.order, "amount"),
    },
    currency: {
      id: currencyId,
      name: text(raw.currency.name),
      rounding,
      decimalPlaces,
    },
    saleLines: raw.saleLines
      .map((row) => {
        if (relation(row.order_id)[0] !== target.orderId) throw invalid();
        const unit = nullableRelation(row[caps.saleUnitField]);
        return {
          id: financialId(row.id),
          productId: nullableRelation(row.product_id)?.[0] ?? null,
          name: text(row.name),
          displayType:
            row.display_type === false ? null : text(row.display_type),
          uomId: unit?.[0] ?? null,
          uom: unit?.[1] ?? null,
          currencyId: relation(row.currency_id)[0],
          quantity: financialDecimal(row.product_uom_qty),
          delivered: financialDecimal(row.qty_delivered),
          unitPrice: financialDecimal(row.price_unit),
          discount: financialDecimal(row.discount),
          taxIds: ids(row[caps.taxField]),
          amounts: amounts(row, "price"),
          writeDate: date(row.write_date),
        };
      })
      .sort((a, b) => a.id - b.id),
    moves: raw.moves
      .map((row) => ({
        id: financialId(row.id),
        saleLineId: nullableRelation(row.sale_line_id)?.[0] ?? null,
        pickingId: nullableRelation(row.picking_id)?.[0] ?? null,
        productId: relation(row.product_id)[0],
        productName: relation(row.product_id)[1],
        uomId: relation(row[caps.unitField])[0],
        uom: relation(row[caps.unitField])[1],
        demand: financialDecimal(row.product_uom_qty),
        quantity: financialDecimal(row[caps.quantityField]),
        state: text(row.state),
        returnedMoveId:
          nullableRelation(row.origin_returned_move_id)?.[0] ?? null,
        writeDate: date(row.write_date),
      }))
      .sort((a, b) => a.id - b.id),
    relatedPickings: raw.pickings.map(picking).sort((a, b) => a.id - b.id),
  };
}
