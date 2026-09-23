import { startDriverRoute } from "@/core/route-start";
import { mobileBody, mobilePrincipal } from "@/server/driver-mobile-http";
import { integer } from "@/core/orders-validation";
import { endpoint, json } from "@/server/http";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const { pool, config, driver } = await mobilePrincipal(request);
    const body = await mobileBody(request);
    return json(await startDriverRoute(
      pool, driver.driver_id, (await context.params).id,
      integer(body.expectedRevision, 1), config.timezone,
    ));
  });
}
