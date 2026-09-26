import { retryDriverOrder } from "@/core/driver-order-retry";
import { mobileBody, mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint, json } from "@/server/http";

export function POST(request: Request, context: { params: Promise<{ id: string; stopId: string; shipmentId: string }> }) {
  return endpoint(async () => {
    const { pool, config } = await mobilePrincipal(request);
    const { id, stopId, shipmentId } = await context.params;
    return json(await retryDriverOrder(pool, request.headers.get("authorization"), id, stopId,
      shipmentId, await mobileBody(request), config.timezone));
  });
}
