import { endpoint, json, principal } from "@/server/http";
import { readSettlementDetail } from "@/core/finance-read";
export function GET(
  request: Request,
  context: { params: Promise<{ executionId: string }> },
) {
  return endpoint(async () => {
    const { pool, user } = await principal("settlement");
    return json(
      await readSettlementDetail(
        pool,
        user.id,
        (await context.params).executionId,
      ),
    );
  });
}
