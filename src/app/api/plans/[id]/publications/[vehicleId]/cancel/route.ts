import { cancelStartedRoute } from "@/core/route-publications";
import { body, endpoint, json, principal } from "@/server/http";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string; vehicleId: string }> },
) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    const { id, vehicleId } = await context.params;
    return json(await cancelStartedRoute(pool, user.id, id, vehicleId, input));
  });
}
