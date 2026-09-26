import { executeDriverOrderCommand } from "@/core/driver-order-command";
import { mobileBody, mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint, json } from "@/server/http";
import { tryCleanIncidentEvidence } from "@/core/driver-incident-evidence";

export function POST(request: Request, context: { params: Promise<{ id: string; stopId: string; shipmentId: string }> }) {
  return endpoint(async () => {
    const { pool, config } = await mobilePrincipal(request);
    const { id, stopId, shipmentId } = await context.params;
    const result = await executeDriverOrderCommand(pool, request.headers.get("authorization"), id, stopId,
      shipmentId, await mobileBody(request, 16_384), config.timezone);
    await tryCleanIncidentEvidence(pool);
    return json(result);
  });
}
