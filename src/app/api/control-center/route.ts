import { readControlLayout, saveControlLayout } from "@/core/live-tracking";
import { body, endpoint, json, principal } from "@/server/http";
export function GET() { return endpoint(async () => { const { pool, user } = await principal(); return json(await readControlLayout(pool, user.id)); }); }
export function PUT(request: Request) { return endpoint(async () => {
  const { pool, user } = await principal(); return json(await saveControlLayout(pool, user.id, await body(request, 16384)));
}); }
