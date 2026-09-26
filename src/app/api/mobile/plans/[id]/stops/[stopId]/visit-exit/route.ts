import { exitDriverVisit } from "@/core/driver-stop-command";
import { mobileBody, mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint, json } from "@/server/http";

export function POST(request: Request, context: { params: Promise<{ id: string; stopId: string }> }) {
  return endpoint(async () => {
    const { pool, config } = await mobilePrincipal(request);
    const { id, stopId } = await context.params;
    return json(await exitDriverVisit(pool, request.headers.get("authorization"), id, stopId,
      await mobileBody(request), config.timezone));
  });
}
