import { readDriverCommandResult } from "@/core/driver-command-receipts";
import { mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint, json } from "@/server/http";
export function GET(request: Request, context: { params: Promise<{ id: string; commandId: string }> }) {
  return endpoint(async () => {
    const { pool } = await mobilePrincipal(request);
    const { id, commandId } = await context.params;
    return json(await readDriverCommandResult(pool, request.headers.get("authorization"), id, commandId));
  });
}
