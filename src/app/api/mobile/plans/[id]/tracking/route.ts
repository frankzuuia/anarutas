import { writeLiveTracking } from "@/core/live-tracking";
import { mobileBody, mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint, json } from "@/server/http";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const { pool } = await mobilePrincipal(request);
    return json(await writeLiveTracking(pool, request.headers.get("authorization"), (await context.params).id, await mobileBody(request)));
  });
}
