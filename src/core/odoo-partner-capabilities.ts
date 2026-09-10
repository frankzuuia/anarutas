import { AppError } from "./errors";

const candidates = [
  "id",
  "name",
  "company_id",
  "parent_id",
  "commercial_partner_id",
  "type",
  "is_company",
  "active",
  "ref",
  "phone",
  "mobile",
  "street",
  "street2",
  "city",
  "zip",
  "state_id",
  "country_id",
] as const;

export function partnerCapabilities(value: unknown) {
  if (!value || Array.isArray(value))
    throw new AppError("ODOO_SCHEMA_UNSUPPORTED", 502);
  const metadata = value as Record<string, unknown>;
  for (const required of ["id", "name", "company_id"])
    if (!metadata[required] || typeof metadata[required] !== "object")
      throw new AppError("ODOO_SCHEMA_UNSUPPORTED", 502);
  const fields = candidates.filter(
    (field) => metadata[field] && typeof metadata[field] === "object",
  );
  return {
    fields: [...fields],
    has: (field: (typeof candidates)[number]) => fields.includes(field),
  };
}
