import { readSegmentEstimate } from "@/core/live-segment";
import { body, endpoint, json, principal } from "@/server/http";

export function POST(request: Request) {
  return endpoint(async () => {
    const { pool, user } = await principal();
    return json(await readSegmentEstimate(pool, user.id, await body(request)));
  });
}
