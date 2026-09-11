import { saveDeparture } from "@/core/departure";
import { body, endpoint, json, principal } from "@/server/http";

export function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    return json(
      await saveDeparture(pool, user.id, (await context.params).id, input),
    );
  });
}
