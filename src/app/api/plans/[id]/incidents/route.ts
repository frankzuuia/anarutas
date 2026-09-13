import { readRouteIncidents } from "@/core/route-incidents-query";
import { endpoint, json, principal } from "@/server/http";

export function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const { pool } = await principal();
    return json(await readRouteIncidents(pool, (await context.params).id));
  });
}
