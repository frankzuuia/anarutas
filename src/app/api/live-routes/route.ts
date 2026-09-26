import { readLiveRoutes } from "@/core/live-routes";
import { endpoint, json, principal } from "@/server/http";
export function GET() { return endpoint(async () => { const { pool, user } = await principal(); return json(await readLiveRoutes(pool, user.id)); }); }
