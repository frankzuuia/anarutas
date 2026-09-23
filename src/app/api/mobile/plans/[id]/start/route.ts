import { startDriverRoute } from "@/core/route-start";
import { mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint, json } from "@/server/http";

export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const { pool, config, driver } = await mobilePrincipal(request);
    return json(await startDriverRoute(pool, driver.driver_id, (await context.params).id, config.timezone));
  });
}
