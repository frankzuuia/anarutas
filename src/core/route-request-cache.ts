// Request-scoped memoization. Concurrent identical reads share the same work;
// rejected reads are evicted so a later explicit attempt can recover.
export function createRequestCache<T>() {
  const values = new Map<string, Promise<T>>();
  return (key: string, read: () => Promise<T>) => {
    const existing = values.get(key);
    if (existing) return existing;
    const value = Promise.resolve()
      .then(read)
      .catch((error: unknown) => {
        values.delete(key);
        throw error;
      });
    values.set(key, value);
    return value;
  };
}

export function roadLegCacheKey(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  departure: string,
  now: number,
) {
  return JSON.stringify([
    from.latitude,
    from.longitude,
    to.latitude,
    to.longitude,
    departure,
    Date.parse(departure) > now ? "forecast" : "static",
  ]);
}
