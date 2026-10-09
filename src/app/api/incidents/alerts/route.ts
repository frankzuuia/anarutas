import { readIncidentAlerts, updateIncidentAlarm } from "@/core/incident-board";
import { body, endpoint, json, principal } from "@/server/http";
export function GET(request: Request) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    return json(
      await readIncidentAlerts(
        pool,
        user.id,
        new URL(request.url).searchParams,
      ),
    );
  });
}
export function PUT(request: Request) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    return json(await updateIncidentAlarm(pool, user.id, await body(request)));
  });
}
