import { bootstrap } from "@/core/auth";
import { body, database, endpoint, json } from "@/server/http";
export function POST(request: Request) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, config } = await database();
    return json(await bootstrap(pool, config, input), 201);
  });
}
