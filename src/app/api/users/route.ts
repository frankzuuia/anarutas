import { createUser } from "@/core/auth";
import { body, endpoint, json, principal } from "@/server/http";
export function GET() {
  return endpoint(async () => {
    const { pool } = await principal();
    return json(
      (
        await pool.query(
          "SELECT id,name,login,active,created_at FROM route_users ORDER BY created_at",
        )
      ).rows,
    );
  });
}
export function POST(request: Request) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    return json(await createUser(pool, user.id, input), 201);
  });
}
