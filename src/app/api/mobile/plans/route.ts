import { listDriverPlans } from "@/core/driver-mobile-route";
import { endpoint, json } from "@/server/http";
import { mobilePrincipal } from "@/server/driver-mobile-http";

export function GET(request: Request) {
  return endpoint(async () => {
    const { pool, driver } = await mobilePrincipal(request);
    return json(await listDriverPlans(pool, driver.driver_id));
  });
}
