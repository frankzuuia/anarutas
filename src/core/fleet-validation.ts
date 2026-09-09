import {
  fuels,
  bloodTypes,
  documentKinds,
  type DocumentKind,
} from "./fleet-contract";
import { AppError } from "./errors";

export function field(value: unknown, min = 1, max = 120): string {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw new AppError("FLEET_INVALID");
  return value.trim();
}
export function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new AppError("FLEET_INVALID");
  return value;
}
export function vehicleInput(input: Record<string, unknown>) {
  const plate = field(input.plate, 1, 32)
    .normalize("NFKC")
    .toUpperCase()
    .replaceAll(" ", "")
    .replaceAll("-", "");
  if (!plate) throw new AppError("FLEET_INVALID");
  if (
    // Stryker disable next-line ConditionalExpression: Number.isFinite also rejects every non-number; typeof is required for TypeScript narrowing.
    typeof input.mileage !== "number" ||
    !Number.isFinite(input.mileage) ||
    input.mileage < 0 ||
    input.mileage > 9999999999.99
  )
    throw new AppError("FLEET_INVALID");
  if (!fuels.some((fuel) => fuel === input.fuel))
    throw new AppError("FLEET_INVALID");
  return {
    name: field(input.name),
    brand: field(input.brand),
    model: field(input.model),
    plate,
    mileage: input.mileage.toFixed(2),
    fuel: input.fuel as string,
    available: bool(input.available),
  };
}
export function driverInput(input: Record<string, unknown>) {
  if (!bloodTypes.some((value) => value === input.blood_type))
    throw new AppError("FLEET_INVALID");
  return {
    name: field(input.name, 2),
    phone: field(input.phone, 5, 40),
    emergency_name: field(input.emergency_name, 0),
    emergency_phone: field(input.emergency_phone, 0, 40),
    blood_type: input.blood_type as string,
    active: bool(input.active),
  };
}
export function documentKind(value: unknown): DocumentKind {
  if (!documentKinds.some((kind) => kind === value))
    throw new AppError("DOCUMENT_INVALID");
  return value as DocumentKind;
}
