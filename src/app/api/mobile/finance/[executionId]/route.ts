import { endpoint, json, database } from "@/server/http";
import { readMobileFinanceDetail } from "@/core/finance-read";
export function GET(
  request: Request,
  context: { params: Promise<{ executionId: string }> },
) {
  return endpoint(async () => {
    const { pool } = await database();
    return json(
      await readMobileFinanceDetail(
        pool,
        request.headers.get("authorization"),
        (await context.params).executionId,
      ),
    );
  });
}
