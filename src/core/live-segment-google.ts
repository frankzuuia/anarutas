import { AppError } from "./errors";
import type { SegmentPoint } from "./live-segment-policy";

// Routes API permits 25 intermediate waypoints, plus origin and destination.
export function segmentRoadRequests(points: SegmentPoint[]) {
  const chunks: SegmentPoint[][] = [];
  for (let i = 0; i < points.length-1; i += 26) chunks.push(points.slice(i, i+27));
  return chunks.map(chunk => {
    const waypoint = (p: SegmentPoint) => ({ location: { latLng: p } });
    return { origin: waypoint(chunk[0]), destination: waypoint(chunk.at(-1)!),
      intermediates: chunk.slice(1,-1).map(waypoint), travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE", computeAlternativeRoutes: false,
      optimizeWaypointOrder: false, languageCode: "es-MX", units: "METRIC" };
  });
}

export function parseSegmentDuration(raw: unknown) {
  const routes = (raw as { routes?: { duration?: unknown }[] } | null)?.routes;
  if (!Array.isArray(routes) || routes.length !== 1) throw new AppError("SEGMENT_GOOGLE_RESPONSE", 503);
  const duration = routes[0]?.duration;
  const seconds = typeof duration === "string" && /^\d+(?:\.\d{1,9})?s$/.test(duration)
    ? Number(duration.slice(0,-1)) : NaN;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > Number.MAX_SAFE_INTEGER)
    throw new AppError("SEGMENT_GOOGLE_RESPONSE", 503);
  return Math.ceil(seconds);
}

export async function requestSegmentRoadTime(points: SegmentPoint[], signal: AbortSignal) {
  const requests = segmentRoadRequests(points);
  if (!requests.length) return 0;
  const key = process.env.RUTAS_GOOGLE_ROUTES_API_KEY?.trim();
  if (!key) throw new AppError("SEGMENT_GOOGLE_CONFIG", 503);
  let total = 0;
  for (const request of requests) {
    let response: Response;
    try {
      response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST", redirect: "error", signal,
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "routes.duration" },
        body: JSON.stringify({ ...request,
          ...(total ? { departureTime: new Date(Date.now()+total*1000).toISOString() } : {}) }),
      });
    } catch { throw new AppError("SEGMENT_GOOGLE_UNAVAILABLE", 503); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(response.status === 429 ? "SEGMENT_GOOGLE_QUOTA" : "SEGMENT_GOOGLE_UNAVAILABLE", 503);
    }
    try {
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 131072) { await reader.cancel(); throw new Error(); }
        chunks.push(part.value);
      }
      total += parseSegmentDuration(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch { throw new AppError("SEGMENT_GOOGLE_RESPONSE", 503); }
  }
  return total;
}
