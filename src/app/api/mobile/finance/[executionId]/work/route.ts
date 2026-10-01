import { endpoint, json, database } from "@/server/http";
import { mobileBody } from "@/server/driver-mobile-http";
import { completeDriverWork } from "@/core/route-work";
export function POST(
  request: Request,
  context: { params: Promise<{ executionId: string }> },
) {
  return endpoint(async () => {
    const raw = await mobileBody(request);
    const { pool } = await database();
    return json(
      await completeDriverWork(
        pool,
        request.headers.get("authorization"),
        (await context.params).executionId,
        raw,
      ),
    );
  });
}
