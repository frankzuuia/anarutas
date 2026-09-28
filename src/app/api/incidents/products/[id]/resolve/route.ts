import { resolveProductIncident } from "@/core/product-incidents";
import { body, endpoint, json, principal } from "@/server/http";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    return json(await resolveProductIncident(pool, user.id, (await context.params).id, await body(request)));
  });
}
