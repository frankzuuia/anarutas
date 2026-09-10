import { updateCustomer } from "@/core/customers";
import { body, endpoint, json, principal } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export function PATCH(request: Request, context: Context) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    return json(
      await updateCustomer(pool, user.id, (await context.params).id, input),
    );
  });
}
