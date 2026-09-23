import { listRoutePublications, publishRoutes } from "@/core/route-publications";
import { body, endpoint, json, principal } from "@/server/http";

export function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const { pool } = await principal();
    return json(await listRoutePublications(pool, (await context.params).id));
  });
}

export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const input = await body(request);
    const { pool, user } = await principal();
    return json(
      await publishRoutes(pool, user.id, (await context.params).id, input),
    );
  });
}
