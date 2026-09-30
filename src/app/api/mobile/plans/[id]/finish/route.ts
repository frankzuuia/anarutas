import { completeDriverRoute } from "@/core/driver-route-completion";
import { mobileBody, mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint, json } from "@/server/http";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const { pool } = await mobilePrincipal(request);
    const { id } = await context.params;
    return json(await completeDriverRoute(pool, request.headers.get("authorization"), id, await mobileBody(request, 16_384)));
  });
}
