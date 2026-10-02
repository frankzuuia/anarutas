import { AppError } from "./errors";
import type { Shipment } from "./orders-contract";

// A single visit must fit inside the existing Google model's 364-day horizon.
export const maximumUnloadingMinutes = 364 * 24 * 60 - 1;

export function unloadingMinutesInput(value: unknown) {
  if (value === undefined || value === null) return value;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximumUnloadingMinutes
  )
    throw new AppError("INVALID_INPUT");
  return value;
}

export function visitServiceSeconds(
  shipments: Pick<Shipment, "partnerId" | "unloadingMinutes">[],
) {
  const customers = new Map<number, number>();
  for (const shipment of shipments) {
    const minutes = unloadingMinutesInput(shipment.unloadingMinutes) ?? 0;
    customers.set(
      shipment.partnerId,
      Math.max(customers.get(shipment.partnerId) ?? 0, minutes),
    );
  }
  return [...customers.values()].reduce(
    (sum, minutes) => sum + minutes * 60,
    0,
  );
}

export function physicalVisitKey(shipment: Shipment) {
  const windows = [
    ...new Set(
      shipment.deliveryWindows.map((w) => `${w.startMinute}:${w.endMinute}`),
    ),
  ].sort();
  return JSON.stringify([shipment.latitude, shipment.longitude, windows]);
}

// Only consecutive visits merge: manual departures and later revisits still
// consume service time, while duplicate orders at the same stop do not.
export function consecutiveServiceSeconds(shipments: Shipment[]) {
  const seconds = new Map<string, number>();
  let members: Shipment[] = [];
  for (let index = 0; index < shipments.length; index++) {
    const shipment = shipments[index];
    members.push(shipment);
    const next = shipments[index + 1];
    if (!next || physicalVisitKey(next) !== physicalVisitKey(shipment)) {
      seconds.set(shipment.id, visitServiceSeconds(members));
      members = [];
    }
  }
  return seconds;
}
