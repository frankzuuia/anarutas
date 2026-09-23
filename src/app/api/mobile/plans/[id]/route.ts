import { readDriverPlan } from "@/core/driver-mobile-route";
import { endpoint, json } from "@/server/http";
import { mobilePrincipal } from "@/server/driver-mobile-http";

export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const { pool, config, driver } = await mobilePrincipal(request);
    const { id } = await context.params;
    return json(await readDriverPlan(pool, driver.driver_id, id, config.timezone));
  });
}
