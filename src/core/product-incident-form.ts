import { AppError } from "./errors";
import { serviceNote } from "./driver-service-policy";

export const incidentDepartments = ["Operaciones", "Compras", "Ventas"] as const;
export const incidentConcepts = ["Especiales", "Reparto", "Picking"] as const;
export const incidentCommentNames = {
  special: "Especiales",
  customer_specifications: "No cumple con las especificaciones del cliente",
  order_quantity_changed: "Se modificó la cantidad en la orden",
  product_not_ordered: "No venía el producto en el pedido",
} as const;
export type IncidentComment = keyof typeof incidentCommentNames;
export const maximumProductPhotos = 3;

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
  if (raw.formVersion !== 2 || !incidentConcepts.some(value => value === raw.concept))
    throw new AppError("INVALID_PRODUCT_FORM");
  // Known, unique codes already bound the list to the size of the catalog.
  if (!Array.isArray(raw.comments) ||
      raw.comments.some(code => typeof code !== "string" || !Object.hasOwn(incidentCommentNames, code)) ||
      new Set(raw.comments).size !== raw.comments.length) throw new AppError("INVALID_PRODUCT_FORM");
  const selected = raw.comments;
  const comments = Object.keys(incidentCommentNames).filter(code => selected.includes(code)) as IncidentComment[];
  const additionalNote = serviceNote(raw.note);
  const note = serviceNote([...comments.map(code => incidentCommentNames[code]), additionalNote].join("\n"));
  return { formVersion: 2 as const, concept: raw.concept as typeof incidentConcepts[number], comments, additionalNote, note };
}
