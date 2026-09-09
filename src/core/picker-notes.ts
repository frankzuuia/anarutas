import { AppError } from "./errors";

/** Exact Studio metadata match, same contract used by QR; no guessed field IDs. */
export function pickerNoteField(
  metadata: unknown,
  configured = "",
  label = "Nota para picker",
): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new AppError("ODOO_SCHEMA_UNSUPPORTED", 502);
  const fields = metadata as Record<string, { type?: string; string?: string }>;
  const text = (field: { type?: string } | undefined) =>
    field?.type === "char" || field?.type === "text";
  if (configured) {
    if (!Object.hasOwn(fields, configured) || !text(fields[configured]))
      throw new AppError("ODOO_PICKER_FIELD_INVALID", 502);
    return configured;
  }
  const matches = Object.entries(fields).filter(
    ([, field]) =>
      text(field) &&
      field.string?.trim().toLocaleLowerCase() ===
        label.trim().toLocaleLowerCase(),
  );
  if (matches.length > 1)
    throw new AppError("ODOO_PICKER_FIELD_AMBIGUOUS", 502);
  return matches[0]?.[0] ?? null;
}

export function pickerNoteValue(value: unknown): string | undefined {
  if (value === false || value === null || value === undefined)
    return undefined;
  if (typeof value !== "string")
    throw new AppError("ODOO_INVALID_RESPONSE", 502);
  return value.trim() || undefined;
}
