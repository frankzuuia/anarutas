import { endpoint, json, principal } from "@/server/http";
import { listSettlements } from "@/core/finance-read";
export function GET(request: Request) {
  return endpoint(async () => {
    const { pool, user, config } = await principal("settlement");
    return json(
      await listSettlements(
        pool,
        user.id,
        new URL(request.url).searchParams,
        config.timezone,
      ),
    );
  });
}
