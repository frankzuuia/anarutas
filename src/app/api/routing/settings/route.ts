import {
  getRoutingSettings,
  saveRoutingSettings,
} from "@/core/routing-settings";
import { body, endpoint, json, principal } from "@/server/http";

export function GET() {
  return endpoint(async () => {
    const { pool } = await principal();
    return json(await getRoutingSettings(pool));
  });
}

export function PUT(request: Request) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    return json(await saveRoutingSettings(pool, user.id, input));
  });
}
