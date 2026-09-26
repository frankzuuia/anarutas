import { addDriverCustomerPhone } from "@/core/driver-customer-phone";
import { mobileBody, mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint, json } from "@/server/http";
export function POST(request: Request, context: { params: Promise<{ id: string; stopId: string }> }) {
  return endpoint(async () => {
    const { pool } = await mobilePrincipal(request);
    const { id, stopId } = await context.params;
    return json(await addDriverCustomerPhone(pool, request.headers.get("authorization"), id, stopId, await mobileBody(request)));
  });
}
