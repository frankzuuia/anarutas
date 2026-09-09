import { editPlan } from "@/core/plans";
import { body, endpoint, json, principal } from "@/server/http";
export function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    return json(
      await editPlan(pool, user.id, (await context.params).id, input),
    );
  });
}
