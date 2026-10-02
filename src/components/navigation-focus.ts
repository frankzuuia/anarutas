export function navigationFocusTarget<T>(
  items: readonly T[],
  current: unknown,
  backwards: boolean,
): T | undefined {
  const first = items[0];
  const last = items.at(-1);
  if (backwards && current === first) return last;
  if (!backwards && current === last) return first;
  return undefined;
}
