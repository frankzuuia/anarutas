import { AppError } from "./errors";
import { serviceNote } from "./driver-service-policy";

export const incidentDepartments = ["Operaciones", "Compras", "Ventas"] as const;
export const legacyIncidentConcepts = ["Especiales", "Reparto", "Picking"] as const;
export const incidentConcepts = [...legacyIncidentConcepts, "Error en compra"] as const;
export const legacyIncidentCommentNames = {
  special: "Especiales",
  customer_specifications: "No cumple con las especificaciones del cliente",
  order_quantity_changed: "Se modificó la cantidad en la orden",
  product_not_ordered: "No venía el producto en el pedido",
} as const;
export const incidentCommentNames = {
  ...legacyIncidentCommentNames,
  late_arrival: "Llegada tardía",
  poor_quality: "Mala calidad",
  damaged_product: "Producto golpeado",
} as const;
export type IncidentComment = keyof typeof incidentCommentNames;
export const productCommentsByKind = {
  shortage_validation: ["product_not_ordered", "late_arrival"],
  shortage_warehouse: ["product_not_ordered"],
  replacement_quality: Object.keys(legacyIncidentCommentNames),
  replacement_wrong_product: Object.keys(legacyIncidentCommentNames),
  return: ["customer_specifications", "poor_quality", "damaged_product"],
} as const;
export const maximumProductPhotos = 3;

export function supportedProductFormVersion(value: unknown): value is 2 | 3 {
  return value === 2 || value === 3;
}

export function productPhotoCount(count: number) {
  if (!Number.isInteger(count) || count < 0 || count > maximumProductPhotos)
    throw new AppError("INVALID_PRODUCT_PHOTO_COUNT");
}

// Versioned fields preserve receipt hashes for requests already queued by APK 0.8.0.
export function productFormInput(raw: Record<string, unknown>) {
  if (raw.formVersion === undefined) {
    if (raw.concept !== undefined || raw.comments !== undefined) throw new AppError("INVALID_PRODUCT_FORM");
    return undefined;
  }
  if (!supportedProductFormVersion(raw.formVersion))
    throw new AppError("INVALID_PRODUCT_FORM");
  const version = raw.formVersion;
  if (version === 3 && (typeof raw.kind !== "string" || !Object.hasOwn(productCommentsByKind, raw.kind)))
    throw new AppError("INVALID_PRODUCT_FORM");
  const isReturn = version === 3 && raw.kind === "return";
  const concepts = version === 2 ? legacyIncidentConcepts : incidentConcepts;
  if (isReturn ? raw.concept != null : !concepts.some(value => value === raw.concept))
    throw new AppError("INVALID_PRODUCT_FORM");
  const allowed: readonly string[] = version === 2 ? Object.keys(legacyIncidentCommentNames)
    : productCommentsByKind[raw.kind as keyof typeof productCommentsByKind];
  // Known, unique codes already bound the list to the size of the catalog.
  if (!Array.isArray(raw.comments) ||
      raw.comments.some(code => typeof code !== "string" || !allowed.includes(code)) ||
      new Set(raw.comments).size !== raw.comments.length) throw new AppError("INVALID_PRODUCT_FORM");
  const selected = raw.comments;
  const comments = allowed.filter(code => selected.includes(code)) as IncidentComment[];
  const additionalNote = serviceNote(raw.note);
  const note = serviceNote([...comments.map(code => incidentCommentNames[code]), additionalNote].join("\n"));
  return { formVersion: version, concept: isReturn ? null : raw.concept as typeof incidentConcepts[number], comments, additionalNote, note };
}
