import { readDriverIncidents } from "@/core/driver-incidents";
import { endpoint, json, principal } from "@/server/http";

export function GET(request: Request) {
  return endpoint(async () => {
    const { pool, config } = await principal();
    return json(await readDriverIncidents(pool, new URL(request.url).searchParams, config.timezone));
  });
}
