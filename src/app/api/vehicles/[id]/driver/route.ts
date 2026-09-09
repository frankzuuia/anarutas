import { assignDriver } from "@/core/fleet";
import { body, endpoint, json, principal } from "@/server/http";
export function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    const { id } = await context.params;
    return json(await assignDriver(pool, user.id, id, await body(request)));
  });
}
