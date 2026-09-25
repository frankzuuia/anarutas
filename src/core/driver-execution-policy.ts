import { AppError } from "./errors";
import { integer, uuid } from "./orders-validation";

export type GeoPoint = { latitude: number; longitude: number };
export type OperationPolicy = {
  radiusMeters: number;
  maxAccuracyMeters: number;
  maxSampleAgeSeconds: number;
  version: number;
};
export type GpsSample = GeoPoint & {
  accuracyMeters: number;
  ageMilliseconds: number;
  capturedAt: string;
  mock: false;
};

export function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("INVALID_INPUT");
  return value as Record<string, unknown>;
}

function finite(value: unknown, low: number, high: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high)
    throw new AppError("INVALID_INPUT");
  return value;
}

export function geoPoint(value: unknown): GeoPoint {
  const input = objectInput(value);
  return {
    latitude: finite(input.latitude, -90, 90),
    longitude: finite(input.longitude, -180, 180),
  };
}

export function operationPolicyInput(input: Record<string, unknown>): OperationPolicy {
  const radiusMeters = integer(finite(input.radiusMeters, 25, 1000));
  return {
    radiusMeters,
    maxAccuracyMeters: integer(finite(input.maxAccuracyMeters, 1, radiusMeters)),
    maxSampleAgeSeconds: integer(finite(input.maxSampleAgeSeconds, 5, 120)),
    version: integer(input.expectedVersion, 1),
  };
}

export function gpsSample(value: unknown): GpsSample {
  const input = objectInput(value);
  const point = geoPoint(input);
  if (input.mock !== false) throw new AppError("LOCATION_UNTRUSTED", 422);
  if (typeof input.capturedAt !== "string" ||
      !Number.isFinite(Date.parse(input.capturedAt))) throw new AppError("INVALID_INPUT");
  return {
    ...point,
    accuracyMeters: finite(input.accuracyMeters, 0, 100_000),
    ageMilliseconds: integer(input.ageMilliseconds),
    capturedAt: new Date(input.capturedAt).toISOString(),
    mock: false,
  };
}

export function distanceMeters(a: GeoPoint, b: GeoPoint) {
  const rad = Math.PI / 180;
  const halfLat = (b.latitude - a.latitude) * rad / 2;
  const halfLon = (b.longitude - a.longitude) * rad / 2;
  const hav = Math.sin(halfLat) ** 2 + Math.cos(a.latitude * rad) *
    Math.cos(b.latitude * rad) * Math.sin(halfLon) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(Math.min(1, hav)), Math.sqrt(Math.max(0, 1 - hav)));
}

export function validateProximity(sample: GpsSample, point: GeoPoint,
  policy: OperationPolicy, now: Date) {
  const wallAge = now.getTime() - Date.parse(sample.capturedAt);
  if (wallAge < 0 || wallAge > policy.maxSampleAgeSeconds * 1000 ||
      sample.ageMilliseconds > policy.maxSampleAgeSeconds * 1000)
    throw new AppError("LOCATION_STALE", 422);
  if (sample.accuracyMeters > policy.maxAccuracyMeters)
    throw new AppError("LOCATION_IMPRECISE", 422);
  const distance = distanceMeters(sample, point);
  if (distance + sample.accuracyMeters > policy.radiusMeters)
    throw new AppError("OUTSIDE_ARRIVAL_RADIUS", 422);
  return distance;
}

export type PublishedOrder = {
  id: string; customerName: string; address: string; orderName: string;
  latitude: number | null; longitude: number | null;
  deliveryWindows: { startMinute: number; endMinute: number }[];
};
export function groupExecutionStops(orders: PublishedOrder[], customers: Map<string, string>) {
  const stops: { customerId: string; orders: PublishedOrder[] }[] = [];
  for (const order of orders) {
    uuid(order.id);
    const customerId = customers.get(order.id);
    if (!customerId) throw new AppError("EXECUTION_CUSTOMER_MISSING", 409);
    const previous = stops.at(-1);
    const last = previous?.orders.at(-1);
    if (previous?.customerId === customerId && last?.address === order.address &&
        last.latitude === order.latitude && last.longitude === order.longitude) previous.orders.push(order);
    else stops.push({ customerId, orders: [order] });
  }
  return stops;
}

export function lastClosingMinute(windows: PublishedOrder["deliveryWindows"]) {
  if (!windows.length) return null;
  return Math.max(...windows.map((window) => integer(finite(window.endMinute, 1, 1440))));
}

export function arrivalLateness(now: Date, close: Date | null): number | null {
  return close === null ? null : Math.max(0, Math.ceil((now.getTime() - close.getTime()) / 1000));
}
