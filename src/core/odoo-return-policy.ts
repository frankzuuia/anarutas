import Decimal from "decimal.js";
import { AppError } from "./errors";
import { uuid } from "./orders-validation";
import { stockMoveCapabilities } from "./odoo-capabilities";

export type ReturnLine = {
  moveId: number;
  productId: number;
  uomId: number;
  quantity: string;
  incidentIds: string[];
};
export type ReturnRequest = {
  id: string;
  source: string;
  companyId: number;
  pickingId: number;
  orderId: number;
  partnerId: number;
  lines: ReturnLine[];
};
export type ReturnReceipt = {
  id: number;
  name: string;
  state: string;
  lines: {
    id: number;
    moveId: number;
    productId: number;
    uomId: number;
    quantity: string;
  }[];
};
type Fields = Record<string, { type?: string; relation?: string }>;

function hasButton(arch: string, name: string) {
  return arch
    .split("<button ")
    .slice(1)
    .some((part) => {
      const attributes = part.split(">")[0];
      return ['"', "'"].some(
        (quote) =>
          attributes.includes(`name=${quote}${name}${quote}`) &&
          attributes.includes(`type=${quote}object${quote}`),
      );
    });
}
/** Select from the actual registry, schema and form contract, never a version guess. */
export function returnCapabilities(
  models: string[],
  move: Fields,
  picking: Fields,
  arch: string,
  wizardArch = "",
) {
  const stock = stockMoveCapabilities(move);
  if (
    picking.return_id?.relation !== "stock.picking" ||
    picking.move_ids?.relation !== "stock.move" ||
    move.origin_returned_move_id?.relation !== "stock.move" ||
    move.product_uom_qty?.type !== "float"
  )
    throw new AppError("ODOO_RETURN_SCHEMA_UNSUPPORTED", 502);
  if (
    models.includes("stock.return.picking") &&
    models.includes("stock.return.picking.line")
  ) {
    const method = (["action_create_returns", "create_returns"] as const).find(
      (name) => hasButton(wizardArch, name),
    );
    if (!method) throw new AppError("ODOO_RETURN_SCHEMA_UNSUPPORTED", 502);
    return { ...stock, mode: "wizard" as const, method };
  }
  if (!hasButton(arch, "action_return"))
    throw new AppError("ODOO_RETURN_SCHEMA_UNSUPPORTED", 502);
  return {
    ...stock,
    mode: "picking" as const,
    method: "action_return" as const,
  };
}

export function returnReference(id: string) {
  return `AR/RETURN/${uuid(id)}`;
}
export function validateReturnRequest(
  request: ReturnRequest,
  source: string,
  company: number,
) {
  returnReference(request.id);
  if (request.source !== source || request.companyId !== company)
    throw new AppError("ODOO_RETURN_SCOPE_CHANGED", 409);
  if (
    ![
      request.pickingId,
      request.orderId,
      request.partnerId,
      request.companyId,
    ].every((id) => Number.isSafeInteger(id) && id > 0) ||
    !request.lines.length
  )
    throw new AppError("ODOO_RETURN_IDENTITY_INVALID", 409);
  const ids = new Set<number>();
  for (const line of request.lines) {
    if (
      ![line.moveId, line.productId, line.uomId].every(
        (id) => Number.isSafeInteger(id) && id > 0,
      ) ||
      ids.has(line.moveId) ||
      !line.incidentIds.length
    )
      throw new AppError("ODOO_RETURN_IDENTITY_INVALID", 409);
    ids.add(line.moveId);
    line.incidentIds.forEach(uuid);
    returnQuantity(line.quantity);
  }
}
export function returnQuantity(value: unknown) {
  try {
    if (typeof value !== "string" && typeof value !== "number") throw Error();
    const quantity = new Decimal(value);
    if (
      !quantity.isFinite() ||
      !quantity.gt(0) ||
      quantity.decimalPlaces() > 6 ||
      quantity.gte("1000000000000")
    )
      throw Error();
    return quantity.toFixed();
  } catch {
    throw new AppError("ODOO_RETURN_QUANTITY_INVALID", 409);
  }
}
export function assertReturnAvailable(
  quantity: string,
  delivered: unknown,
  used: unknown[],
) {
  let values: Decimal[];
  try {
    values = [delivered, ...used].map((value) => new Decimal(String(value)));
    if (values.some((value) => !value.isFinite() || value.lt(0))) throw Error();
  } catch {
    throw new AppError("ODOO_RETURN_IDENTITY_INVALID", 409);
  }
  const available = values[0].minus(
    values.slice(1).reduce((sum, value) => sum.plus(value), new Decimal(0)),
  );
  if (new Decimal(returnQuantity(quantity)).gt(available))
    throw new AppError("ODOO_RETURN_QUANTITY_EXCEEDED", 409);
}
export function assertReturnReceipt(
  request: ReturnRequest,
  receipt: ReturnReceipt,
) {
  if (
    !Number.isSafeInteger(receipt.id) ||
    receipt.id < 1 ||
    receipt.name !== returnReference(request.id) ||
    !["draft", "waiting", "confirmed", "assigned"].includes(receipt.state) ||
    receipt.lines.length !== request.lines.length
  )
    throw new AppError("ODOO_RETURN_REMOTE_CHANGED", 409);
  for (const line of request.lines) {
    const actual = receipt.lines.filter((item) => item.moveId === line.moveId);
    if (
      actual.length !== 1 ||
      actual[0].productId !== line.productId ||
      actual[0].uomId !== line.uomId ||
      !new Decimal(actual[0].quantity).eq(line.quantity)
    )
      throw new AppError("ODOO_RETURN_REMOTE_CHANGED", 409);
  }
}
export function convertReturnQuantity(
  quantity: string,
  from: { factor: string; categoryId: number },
  to: { factor: string; categoryId: number },
) {
  const a = new Decimal(from.factor),
    b = new Decimal(to.factor);
  if (
    from.categoryId !== to.categoryId ||
    !a.isFinite() ||
    !b.isFinite() ||
    !a.gt(0) ||
    !b.gt(0)
  )
    throw new AppError("ODOO_RETURN_UOM_UNSUPPORTED", 409);
  const converted = new Decimal(returnQuantity(quantity)).div(a).times(b);
  if (converted.decimalPlaces() > 6)
    throw new AppError("ODOO_RETURN_UOM_PRECISION", 409);
  return converted.toFixed();
}
