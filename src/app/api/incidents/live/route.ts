import { readLiveIncidents } from "@/core/driver-live-incidents";
import { endpoint, json, principal } from "@/server/http";
export function GET(request: Request) {
  return endpoint(async () => {
    const { pool, config, user } = await principal();
    return json(await readLiveIncidents(pool, user.id, new URL(request.url).searchParams, config.timezone));
  });
}
