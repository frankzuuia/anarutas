import { createPlan, listPlans } from "@/core/plans";
import { body, endpoint, json, principal } from "@/server/http";
export function GET() {
  return endpoint(async () => json(await listPlans((await principal()).pool)));
}
export function POST(request: Request) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    return json(await createPlan(pool, user.id, input), 201);
  });
}
