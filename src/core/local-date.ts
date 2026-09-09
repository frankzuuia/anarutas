export function todayInTimezone(timezone: string, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
