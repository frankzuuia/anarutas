import { readIncidentBoard } from "@/core/incident-board";
import { endpoint, json, principal } from "@/server/http";
export function GET(request: Request) {
  return endpoint(async () => {
    const { pool, config, user } = await principal();
    return json(
      await readIncidentBoard(
        pool,
        user.id,
        new URL(request.url).searchParams,
        config.timezone,
      ),
    );
  });
}
