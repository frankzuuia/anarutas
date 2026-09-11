import { retryRecalculation } from "@/core/route-recalculation";
import { body, endpoint, json, principal } from "@/server/http";

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    await body(request);
    const { pool, user } = await principal();
    await retryRecalculation(pool, user.id, (await context.params).id);
    return json({ queued: true }, 202);
  });
}
