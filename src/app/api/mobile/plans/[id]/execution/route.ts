import { readDriverExecution } from "@/core/driver-execution-read";
import { mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint, json } from "@/server/http";

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const { pool, config, driver } = await mobilePrincipal(request);
    return json(await readDriverExecution(pool, driver.driver_id, (await context.params).id, config.timezone));
  });
}
