import { cancelProductIncidentByAdmin } from "@/core/product-incident-admin-cancel";
import { body, endpoint, json, principal } from "@/server/http";

export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    return json(await cancelProductIncidentByAdmin(pool, user.id, (await context.params).id, await body(request)));
  });
}
