import { body, endpoint, json, principal } from "@/server/http";
import { orderBoard, selectPlanVehicles } from "@/core/orders";
export function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    const id = (await ctx.params).id;
    await selectPlanVehicles(pool, user.id, id, input);
    return json(await orderBoard(pool, id));
  });
}
