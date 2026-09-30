/** Retry-After can be either seconds or an HTTP date; never persist external text. */
export function odooRetryAfter(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (value === null || !value.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds))
    return seconds >= 0 && seconds <= 2_147_483_647
      ? Math.ceil(seconds)
      : undefined;
  const date = Date.parse(value);
  const delay = Math.max(0, Math.ceil((date - now) / 1000));
  return Number.isFinite(delay) && delay <= 2_147_483_647 ? delay : undefined;
}
