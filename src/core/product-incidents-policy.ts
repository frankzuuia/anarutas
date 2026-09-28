import { AppError } from "./errors";
import { serviceNote } from "./driver-service-policy";

export const productIncidentNames = {
  shortage_validation: "Faltante por validación",
  shortage_warehouse: "Faltante desde bodega",
  replacement_quality: "Reposición por calidad",
  replacement_wrong_product: "Reposición por producto erróneo",
  return: "Devolución",
} as const;
export type ProductIncidentKind = keyof typeof productIncidentNames;
export const warehouseReasonNames = { special: "Especiales", quality: "Calidad", late_arrival: "Llegada tardía" } as const;
export type WarehouseReason = keyof typeof warehouseReasonNames;
export function productIncidentDetail(kind: ProductIncidentKind, reason: WarehouseReason | null) {
  if (kind === "shortage_warehouse" && reason) return warehouseReasonNames[reason];
  return { shortage_validation: "Validación", shortage_warehouse: "Faltante desde bodega",
    replacement_quality: "Calidad", replacement_wrong_product: "Producto erróneo", return: "Devolución" }[kind];
}
export function productIncidentClassification(kind: ProductIncidentKind, department: "Operaciones" | "Compras") {
  return { department, concept: kind === "shortage_validation" && department === "Operaciones" ? "Reparto" : null };
}
export function incidentClassificationInput(raw: Record<string, unknown>) {
  return { department: field(raw.department, 120), concept: field(raw.concept, 120) };
}
export function isReplacement(kind: ProductIncidentKind) {
  return kind === "replacement_quality" || kind === "replacement_wrong_product";
}
export function requireProductEvidence(kind: ProductIncidentKind, present: boolean) {
  if (kind !== "shortage_validation" && kind !== "shortage_warehouse" && !present)
    throw new AppError("PRODUCT_EVIDENCE_REQUIRED");
}
function field(value: unknown, maximum: number) {
  if (typeof value !== "string" || !value.trim() || Array.from(value.trim()).length > maximum || /[\u0000-\u001f]/u.test(value))
    throw new AppError("INVALID_PRODUCT_INCIDENT");
  return value.trim();
}
// Decimal strings avoid binary rounding in both aggregate checks and PostgreSQL.
export function incidentQuantity(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") throw new AppError("INVALID_INCIDENT_QUANTITY");
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d{1,12}(?:\.\d{1,6})?$/u.test(text)) throw new AppError("INVALID_INCIDENT_QUANTITY");
  const [whole, fraction = ""] = text.split(".");
  const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (scaled <= 0n) throw new AppError("INVALID_INCIDENT_QUANTITY");
  const remainder = (scaled % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `${scaled / 1_000_000n}${remainder ? `.${remainder}` : ""}`;
}
export function productIncidentInput(raw: Record<string, unknown>) {
  if (typeof raw.kind !== "string" || !Object.hasOwn(productIncidentNames, raw.kind))
    throw new AppError("INVALID_PRODUCT_INCIDENT");
  const kind = raw.kind as ProductIncidentKind;
  if (raw.department !== "Operaciones" && raw.department !== "Compras") throw new AppError("INVALID_INCIDENT_DEPARTMENT");
  const department: "Operaciones" | "Compras" = raw.department;
  const warehouseReason = raw.warehouseReason;
  if (kind === "shortage_warehouse" ? typeof warehouseReason !== "string" || !Object.hasOwn(warehouseReasonNames, warehouseReason)
    : warehouseReason !== undefined && warehouseReason !== null) throw new AppError("INVALID_WAREHOUSE_REASON");
  const manual = kind === "shortage_validation" || kind === "shortage_warehouse";
  const lineIndex = raw.lineIndex;
  if (manual ? lineIndex !== undefined && lineIndex !== null : !Number.isSafeInteger(lineIndex) || (lineIndex as number) < 0)
    throw new AppError("INVALID_PRODUCT_INCIDENT");
  if (!manual && (raw.product !== undefined || raw.unit !== undefined)) throw new AppError("INVALID_PRODUCT_INCIDENT");
  return { kind, department, warehouseReason: kind === "shortage_warehouse" ? warehouseReason as WarehouseReason : null, lineIndex: manual ? null : lineIndex as number,
    product: manual ? field(raw.product, 300) : null, unit: manual ? field(raw.unit, 40) : null,
    quantity: incidentQuantity(raw.quantity), note: serviceNote(raw.note) };
}
