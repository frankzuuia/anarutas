import { AppError } from "./errors";
import {
  customerPriorities,
  fulfillmentModes,
  type CustomerPriority,
  type FulfillmentMode,
} from "./customers-contract";
import { integer } from "./orders-validation";

export function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-MX")
    .trim()
    .split(/\s+/u)
    .join(" ");
}

function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string") throw new AppError("INVALID_INPUT");
  const clean = value.replaceAll("\r\n", "\n").trim();
  if ((required && !clean) || clean.length > maximum)
    throw new AppError("INVALID_INPUT");
  return clean;
}

function selected<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new AppError("INVALID_INPUT");
  return value as T;
}

export type ClockInput = { hour: number; minute: number };

export function clockMinute(value: unknown) {
  if (!value || Array.isArray(value)) throw new AppError("INVALID_INPUT");
  const clock = value as Record<string, unknown>;
  const hour = integer(clock.hour);
  const minute = integer(clock.minute);
  if (hour > 23 || minute > 59) throw new AppError("INVALID_INPUT");
  return hour * 60 + minute;
}

function windows(value: unknown) {
  if (!Array.isArray(value) || value.length > 32)
    throw new AppError("CUSTOMER_WINDOWS_INVALID", 422);
  const parsed = value.map((raw, position) => {
    if (!raw || Array.isArray(raw))
      throw new AppError("CUSTOMER_WINDOWS_INVALID", 422);
    const item = raw as Record<string, unknown>;
    if (!Array.isArray(item.days) || !item.days.length)
      throw new AppError("CUSTOMER_WINDOWS_INVALID", 422);
    const days = [...new Set(item.days.map((day) => integer(day)))].sort();
    if (days.length !== item.days.length || days.some((day) => day > 6))
      throw new AppError("CUSTOMER_WINDOWS_INVALID", 422);
    const startMinute = clockMinute(item.start);
    const endMinute = clockMinute(item.end);
    if (startMinute >= endMinute)
      throw new AppError("CUSTOMER_WINDOWS_INVALID", 422);
    return { days, startMinute, endMinute, position: position + 1 };
  });
  for (let day = 0; day <= 6; day++) {
    const ranges = parsed
      .filter((window) => window.days.includes(day))
      .sort((a, b) => a.startMinute - b.startMinute);
    for (let index = 1; index < ranges.length; index++)
      if (ranges[index].startMinute < ranges[index - 1].endMinute)
        throw new AppError("CUSTOMER_WINDOWS_OVERLAP", 422);
  }
  return parsed;
}

function mapUrl(value: unknown) {
  if (value === null || value === "" || value === undefined) return null;
  const raw = text(value, 1000);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("CUSTOMER_MAP_URL_INVALID", 422);
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    url.protocol === "https:" &&
    (host === "google.com" ||
      host.endsWith(".google.com") ||
      host === "goo.gl" ||
      host.endsWith(".goo.gl") ||
      host === "share.google");
  if (!allowed) throw new AppError("CUSTOMER_MAP_URL_INVALID", 422);
  return url.toString();
}

function location(value: unknown) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("INVALID_INPUT");
  const record = value as Record<string, unknown>;
  if (
    typeof record.latitude !== "number" ||
    typeof record.longitude !== "number"
  )
    throw new AppError("INVALID_INPUT");
  if (
    !Number.isFinite(record.latitude) ||
    !Number.isFinite(record.longitude) ||
    record.latitude < -90 ||
    record.latitude > 90 ||
    record.longitude < -180 ||
    record.longitude > 180
  )
    throw new AppError("INVALID_INPUT");
  return {
    latitude: record.latitude,
    longitude: record.longitude,
    placeId:
      record.placeId === null || record.placeId === undefined
        ? null
        : text(record.placeId, 255),
  };
}

export function customerInput(input: Record<string, unknown>) {
  const allowed = new Set([
    "displayName",
    "phone",
    "deliveryNote",
    "priority",
    "fulfillmentMode",
    "deliveryAddress",
    "mapUrl",
    "location",
    "windows",
    "expectedVersion",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new AppError("INVALID_INPUT");
  return {
    displayName: text(input.displayName, 180, true),
    phone:
      input.phone === null || input.phone === "" ? null : text(input.phone, 80),
    deliveryNote: text(input.deliveryNote, 2000),
    priority: selected(input.priority, customerPriorities) as CustomerPriority,
    fulfillmentMode: selected(
      input.fulfillmentMode,
      fulfillmentModes,
    ) as FulfillmentMode,
    deliveryAddress: text(input.deliveryAddress, 600),
    mapUrl: mapUrl(input.mapUrl),
    location: location(input.location),
    windows: windows(input.windows),
    expectedVersion: integer(input.expectedVersion, 1),
  };
}

export function archiveInput(input: Record<string, unknown>) {
  if (Object.keys(input).some((key) => key !== "expectedVersion"))
    throw new AppError("INVALID_INPUT");
  return { expectedVersion: integer(input.expectedVersion, 1) };
}

export function daysMask(days: number[]) {
  return days.reduce((mask, day) => mask | (1 << day), 0);
}

export function maskDays(mask: number) {
  return Array.from({ length: 7 }, (_, day) => day).filter(
    (day) => (mask & (1 << day)) !== 0,
  );
}

export function mapsUrl(latitude: number, longitude: number) {
  const query = encodeURIComponent(`${latitude},${longitude}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}
