import { AppError } from "./errors";
import { serviceDate } from "./plans";

export function dayAfter(value: string, days = 1) {
  const date = new Date(`${serviceDate(value)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function localMidnight(value: string, timezone: string) {
  const target = new Date(`${serviceDate(value)}T00:00:00Z`).getTime();
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let instant = target;
  // Stryker disable next-line EqualityOperator: a sixth iteration cannot recover a civil midnight after five unchanged fixed-point attempts.
  for (let attempt = 0; attempt < 5; attempt++) {
    const p = Object.fromEntries(
      format.formatToParts(instant).map((x) => [x.type, x.value]),
    );
    const represented = Date.parse(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
    );
    const delta = target - represented;
    if (delta === 0)
      return new Date(instant).toISOString().slice(0, 19).replace("T", " ");
    instant += delta;
  }
  throw new AppError("DATE_BOUNDARY_UNSUPPORTED");
}
export function importRange(input: Record<string, unknown>, timezone: string) {
  const from = serviceDate(input.from),
    to = serviceDate(input.to);
  if (from > to) throw new AppError("INVALID_DATE");
  return {
    from,
    to,
    start: localMidnight(from, timezone),
    end: localMidnight(dayAfter(to), timezone),
  };
}
export function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new AppError("INVALID_INPUT");
  return value as number;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    value
      .split("-")
      .map((x) => x.length)
      .join(",") !== "8,4,4,4,12" ||
    ![...value.replaceAll("-", "").toLowerCase()].every((c) =>
      "0123456789abcdef".includes(c),
    )
  )
    throw new AppError("INVALID_INPUT");
  return value;
}
export function vehicleIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new AppError("INVALID_INPUT");
  const ids = value.map(uuid).sort();
  if (new Set(ids).size !== ids.length) throw new AppError("INVALID_INPUT");
  return ids;
}
