import { createDriver, listDrivers } from "@/core/fleet";
import { body, endpoint, json, principal } from "@/server/http";
export function GET() {
  return endpoint(async () => {
    const { pool } = await principal();
    return json(await listDrivers(pool));
  });
}
export function POST(request: Request) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    return json(await createDriver(pool, user.id, await body(request)), 201);
  });
}
