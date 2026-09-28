import { readProductIncidents } from "@/core/product-incidents";
import { endpoint, json, principal } from "@/server/http";
export function GET(request: Request) {
  return endpoint(async () => {
    const { pool, user, config } = await principal();
    const params = new URL(request.url).searchParams;
    return json(await readProductIncidents(pool, user.id, params, config.timezone, params.get("live") === "true" ? "live" : "history"));
  });
}
