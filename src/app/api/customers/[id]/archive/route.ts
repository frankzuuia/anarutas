import { archiveCustomer, restoreCustomer } from "@/core/customers";
import { body, endpoint, json, principal } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export function POST(request: Request, context: Context) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    return json(
      await archiveCustomer(pool, user.id, (await context.params).id, input),
    );
  });
}

export function DELETE(request: Request, context: Context) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    return json(
      await restoreCustomer(pool, user.id, (await context.params).id, input),
    );
  });
}
