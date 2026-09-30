import { endpoint, json, principal, body } from "@/server/http";
import { decideSettlement } from "@/core/settlements";
export function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  return endpoint(async () => {
    const raw = await body(request);
    const { pool, user } = await principal("settlement");
    return json(
      await decideSettlement(
        pool,
        user.id,
        (await context.params).requestId,
        raw,
      ),
    );
  });
}
