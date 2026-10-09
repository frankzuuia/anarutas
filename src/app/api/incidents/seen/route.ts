import { markIncidentSeen } from "@/core/incident-board";
import { body, endpoint, json, principal } from "@/server/http";
export function POST(request: Request) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    return json(await markIncidentSeen(pool, user.id, await body(request)));
  });
}
