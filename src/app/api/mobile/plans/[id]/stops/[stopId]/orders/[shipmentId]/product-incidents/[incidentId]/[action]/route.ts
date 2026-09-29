import { changeProductIncident } from "@/core/product-incidents";
import { mobileBody, mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint, json } from "@/server/http";
import { AppError } from "@/core/errors";

export function POST(request: Request, context: { params: Promise<{ id: string; stopId: string;
  shipmentId: string; incidentId: string; action: string }> }) {
  return endpoint(async () => {
    const { pool } = await mobilePrincipal(request);
    const { id, stopId, shipmentId, incidentId, action } = await context.params;
    if (action !== "amend" && action !== "cancel") throw new AppError("NOT_FOUND", 404);
    return json(await changeProductIncident(pool, request.headers.get("authorization"), id, stopId,
      shipmentId, incidentId, await mobileBody(request, 16_384), action));
  });
}
