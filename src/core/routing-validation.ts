import { AppError } from "./errors";
import { integer } from "./orders-validation";

function coordinate(value: unknown, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) throw new AppError("ROUTING_SETTINGS_INVALID");
  const number = value as number;
  if (number < minimum || number > maximum)
    throw new AppError("ROUTING_SETTINGS_INVALID");
  return number;
}

export function routingSettingsInput(input: Record<string, unknown>) {
  const address =
    typeof input.depotAddress === "string" ? input.depotAddress.trim() : "";
  const location = input.depotLocation;
  if (!address || address.length > 500 || !location || Array.isArray(location))
    throw new AppError("ROUTING_SETTINGS_INVALID");
  const raw = location as Record<string, unknown>;
  const placeId = raw.placeId == null ? null : String(raw.placeId).trim();
  if (placeId !== null && (!placeId || placeId.length > 300))
    throw new AppError("ROUTING_SETTINGS_INVALID");
  return {
    expectedVersion: integer(input.expectedVersion, 0),
    depotAddress: address,
    depotLocation: {
      latitude: coordinate(raw.latitude, -90, 90),
      longitude: coordinate(raw.longitude, -180, 180),
      placeId,
    },
  };
}
