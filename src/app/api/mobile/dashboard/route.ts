import { readDriverDashboard } from "@/core/driver-mobile-route";
import { endpoint, json } from "@/server/http";
import { mobilePrincipal } from "@/server/driver-mobile-http";

export function GET(request: Request) {
  return endpoint(async () => {
    const { pool, config, driver } = await mobilePrincipal(request);
    const dashboard = await readDriverDashboard(
      pool,
      driver.driver_id,
      config.timezone,
    );
    return json({
      driver: {
        id: driver.driver_id,
        name: driver.name,
        phone: driver.phone,
      },
      timezone: config.timezone,
      ...dashboard,
    });
  });
}
