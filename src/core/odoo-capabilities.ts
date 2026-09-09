import { AppError } from "./errors";

type FieldMetadata = Record<
  string,
  { type?: unknown; relation?: unknown } | undefined
>;

export function stockMoveCapabilities(value: unknown) {
  if (!value || Array.isArray(value))
    throw new AppError("ODOO_SCHEMA_UNSUPPORTED", 502);
  const fields = value as FieldMetadata;
  const quantityField = ["quantity", "quantity_done"].find(
    (name) => fields[name]?.type === "float",
  );
  const unitField = ["uom_id", "product_uom"].find(
    (name) => fields[name]?.relation === "uom.uom",
  );
  if (!quantityField || !unitField)
    throw new AppError("ODOO_SCHEMA_UNSUPPORTED", 502);
  return { quantityField, unitField };
}
