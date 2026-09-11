import { getPlanOptimization } from "@/core/route-optimization";
import { planRouteWithOpenAI } from "@/core/route-ai-planner";
import { body, endpoint, json, principal } from "@/server/http";

export function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const { pool } = await principal();
    return json(await getPlanOptimization(pool, (await context.params).id));
  });
}

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user, config } = await principal();
    return json(
      await planRouteWithOpenAI(
        pool,
        user.id,
        (await context.params).id,
        input,
        config.timezone,
      ),
    );
  });
}
