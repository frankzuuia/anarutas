import { endpoint, json, principal } from "@/server/http";
export function GET() {
  return endpoint(async () => {
    const { pool } = await principal();
    return json(
      (
        await pool.query(
          "SELECT a.id,a.action,a.entity_id,a.details,a.created_at,u.name AS actor FROM route_audit a LEFT JOIN route_users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100",
        )
      ).rows,
    );
  });
}
